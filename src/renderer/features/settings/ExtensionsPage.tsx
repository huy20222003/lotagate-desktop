import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, CircleOff, Plus, Trash2 } from 'lucide-react';
import { Button, Card, Dropdown, EmptyState, Field, Modal, Skeleton, TextArea, TextInput, Tooltip, useToast } from '../../components/ui.js';
import { ExtensionCommandClient, type CommandInvocation, type ExtensionKind, type ExtensionRow, type ExtensionScope } from './extension-command-client.js';
import type { DesktopHookEvent, ExtensionDetail } from '../../../contracts/ipc/v1/extensions.js';
import { Pagination } from '../../components/Pagination.js';
import { AgentMarkdown } from '../workspace/markdown-renderer.js';
import { Scrollbar } from '../../components/Scrollbar.js';
import { z } from 'zod';
import { extensionNameSchema, hookNameSchema, httpUrlSchema, maxUtf8Bytes } from '../../validation/shared.js';
import { isRecord, readString } from '../../utils/data.js';
import { toUserErrorMessage as toMessage } from '../../utils/errors.js';

const EXTENSIONS_PAGE_SIZE = 10;

const PAGE_META: Record<ExtensionKind, { title: string; empty: string; addLabel: string; readOnly?: boolean }> = {
  hook: { title: 'Hooks', empty: 'No hooks are loaded for this trusted workspace.', addLabel: 'Add hook' },
  skill: { title: 'Skills', empty: 'No skills are available.', addLabel: 'Add skill' },
  plugin: { title: 'Plugins', empty: 'No plugins are installed.', addLabel: 'Add plugin' },
  mcp: { title: 'MCP', empty: 'No MCP servers are configured.', addLabel: 'Add MCP server' },
};

const ACTIONS: Record<ExtensionKind, { enable: string; disable: string; remove: string; add?: string }> = {
  hook: { enable: '', disable: '', remove: '' },
  skill: { enable: 'skill.enable', disable: 'skill.disable', remove: 'skill.remove', add: 'plugin.install' },
  plugin: { enable: 'plugin.enable', disable: 'plugin.disable', remove: 'plugin.uninstall', add: 'plugin.install' },
  mcp: { enable: 'mcp.enable', disable: 'mcp.disable', remove: 'mcp.remove', add: 'mcp.add' },
};

export function ExtensionsPage({ kind, cwd, trusted = false }: { kind: ExtensionKind; cwd?: string; trusted?: boolean }) {
  const meta = PAGE_META[kind];
  const client = useMemo(() => new ExtensionCommandClient(), []);
  const [rows, setRows] = useState<ExtensionRow[]>([]);
  const [availableActions, setAvailableActions] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(Boolean(cwd));
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState<string | undefined>();
  const [addOpen, setAddOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<ExtensionRow | undefined>();
  const [detailTarget, setDetailTarget] = useState<{ row: ExtensionRow; detail: ExtensionDetail } | undefined>();
  const { success } = useToast();

  const reload = useCallback(async () => {
    if (!cwd) { setRows([]); setAvailableActions(new Set()); setLoading(false); return; }
    setLoading(true); setError(undefined);
    try {
      const actions = await client.listCommands(cwd);
      if (trusted && actions.has('trust.grant')) await client.execute(cwd, { actionId: 'trust.grant', positionals: [], options: {} });
      const nextRows = await client.list(cwd, kind);
      setAvailableActions(actions); setRows(nextRows);
    } catch (reason) { setError(toMessage(reason)); }
    finally { setLoading(false); }
  }, [client, cwd, kind]);

  useEffect(() => { void reload(); }, [reload]);

  const filteredRows = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return query ? rows.filter(row => `${row.name} ${row.detail} ${row.status}`.toLocaleLowerCase().includes(query)) : rows;
  }, [rows, search]);
  const [page, setPage] = useState(1);
  useEffect(() => { setPage(1); }, [kind, search]);
  const visibleRows = useMemo(() => filteredRows.slice((page - 1) * EXTENSIONS_PAGE_SIZE, page * EXTENSIONS_PAGE_SIZE), [filteredRows, page]);

  const execute = useCallback(async (invocation: CommandInvocation, message: string) => {
    if (!cwd) return;
    setBusy(invocation.actionId + invocation.positionals.join(':'));
    setError(undefined);
    try {
      if (invocation.options['scope'] === 'project' && !trusted) throw new Error('Trust this workspace before changing project-scoped extensions.');
      await client.execute(cwd, invocation); success(message); await reload();
    }
    catch (reason) { setError(toMessage(reason)); }
    finally { setBusy(undefined); }
  }, [client, cwd, reload, success]);

  const changeEnabled = (row: ExtensionRow) => {
    const actionId = row.status === 'ENABLED' ? ACTIONS[kind].disable : ACTIONS[kind].enable;
    if (!actionId || !row.scope) return;
    void execute({ actionId, positionals: [row.name], options: { scope: row.scope } }, `${row.status === 'ENABLED' ? 'Disabled' : 'Enabled'} ${meta.title.toLocaleLowerCase().slice(0, -1)}`);
  };
  const remove = () => {
    if (!removeTarget) return;
    if (kind === 'hook') {
      if (!cwd || removeTarget.editable !== true) return;
      setRemoveTarget(undefined);
      setBusy(`remove:${removeTarget.name}`);
      void window.lotagate.extensions.removeHook({ cwd, name: removeTarget.name }).then(() => { success(`Removed ${removeTarget.name}`); return reload(); }).catch(reason => setError(toMessage(reason))).finally(() => setBusy(undefined));
      return;
    }
    if (!ACTIONS[kind].remove || !removeTarget.scope) return;
    const actionId = ACTIONS[kind].remove;
    setRemoveTarget(undefined);
    void execute({ actionId, positionals: [removeTarget.name], options: { scope: removeTarget.scope } }, `Removed ${removeTarget.name}`);
  };
  const openDetails = async (row: ExtensionRow) => {
    if (!cwd) return;
    setError(undefined);
    try {
      const scope = kind === 'hook' ? row.editable === true ? 'project' : 'plugin' : row.scope;
      const detail = await window.lotagate.extensions.readDetail({ kind, cwd, name: row.name, ...(scope === undefined ? {} : { scope }) });
      setDetailTarget({ row, detail });
    } catch (reason) { setError(toMessage(reason)); }
  };

  return <div className="settings-extension-page"><div className="settings-extension-toolbar"><TextInput value={search} onChange={event => setSearch(event.target.value)} placeholder={`Search ${meta.title.toLocaleLowerCase()}`} aria-label={`Search ${meta.title}`} /><Tooltip label={meta.addLabel}><button type="button" className="icon-button settings-extension-add" aria-label={meta.addLabel} disabled={meta.readOnly || !cwd || (kind === 'hook' ? !trusted : !ACTIONS[kind].add || !hasActionsForAdd(kind, availableActions))} onClick={() => setAddOpen(true)}><Plus size={17} /></button></Tooltip></div>{error ? <Card className="settings-extension-error"><strong>Unable to load {meta.title.toLocaleLowerCase()}</strong><p>{error}</p></Card> : loading ? <ExtensionListSkeleton /> : filteredRows.length === 0 ? <EmptyState title={search ? 'No matching items' : meta.empty} /> : <><div className="settings-extension-list">{visibleRows.map(row => <ExtensionRowView row={row} busy={busy !== undefined} readOnly={meta.readOnly === true || row.scope === 'builtin' || (kind === 'hook' && row.editable !== true)} canToggle={kind !== 'hook'} canRemove={kind === 'hook' ? row.editable === true : true} onOpen={() => void openDetails(row)} onToggle={() => changeEnabled(row)} onRemove={() => setRemoveTarget(row)} key={`${row.name}:${row.scope ?? 'hook'}`} />)}</div><Pagination page={page} pageSize={EXTENSIONS_PAGE_SIZE} total={filteredRows.length} onPageChange={setPage} /></>}{addOpen && cwd && kind === 'hook' ? <HookAddModal busy={busy !== undefined} onClose={() => setAddOpen(false)} onSubmit={input => { setAddOpen(false); setBusy('add:hook'); void window.lotagate.extensions.createHook({ cwd, ...input }).then(() => { success('Added hook'); return reload(); }).catch(reason => setError(toMessage(reason))).finally(() => setBusy(undefined)); }} /> : null}{addOpen && cwd && kind !== 'hook' ? <ExtensionAddModal kind={kind} busy={busy !== undefined} onClose={() => setAddOpen(false)} onSubmit={input => { setAddOpen(false); void execute(input.invocation, input.message); }} /> : null}{removeTarget ? <Modal title={`Remove ${meta.title.slice(0, -1)}`} onClose={() => setRemoveTarget(undefined)}><p className="modal-copy">Remove <strong>{removeTarget.name}</strong>{removeTarget.scope ? ` from ${removeTarget.scope} scope?` : '?'}</p><div className="modal-actions"><Button variant="secondary" onClick={() => setRemoveTarget(undefined)}>Cancel</Button><Button variant="danger" onClick={remove}>Remove</Button></div></Modal> : null}{detailTarget && cwd ? <ExtensionDetailModal kind={kind} cwd={cwd} row={detailTarget.row} detail={detailTarget.detail} onClose={() => setDetailTarget(undefined)} onSaved={() => { setDetailTarget(undefined); void reload(); }} /> : null}</div>;
}

function ExtensionRowView({ row, busy, readOnly, canToggle, canRemove, onOpen, onToggle, onRemove }: { row: ExtensionRow; busy: boolean; readOnly: boolean; canToggle: boolean; canRemove: boolean; onOpen: () => void; onToggle: () => void; onRemove: () => void }) {
  const enabled = row.status === 'ENABLED';
  return <div className="settings-extension-row-clickable" role="button" tabIndex={0} onClick={onOpen} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onOpen(); } }}><Card className="settings-extension-row"><div className="settings-extension-copy"><strong>{row.name}</strong><span>{row.detail}</span></div>{!readOnly ? <div className="settings-extension-actions">{canToggle ? <Tooltip label={enabled ? 'Disable' : 'Enable'}><button type="button" className="icon-button" aria-label={`${enabled ? 'Disable' : 'Enable'} ${row.name}`} disabled={busy} onClick={event => { event.stopPropagation(); onToggle(); }}>{enabled ? <CircleOff size={15} /> : <Check size={15} />}</button></Tooltip> : null}{canRemove ? <Tooltip label="Remove"><button type="button" className="icon-button settings-extension-danger" aria-label={`Remove ${row.name}`} disabled={busy} onClick={event => { event.stopPropagation(); onRemove(); }}><Trash2 size={15} /></button></Tooltip> : null}</div> : null}</Card></div>;
}

function ExtensionDetailModal({ kind, cwd, row, detail, onClose, onSaved }: { kind: ExtensionKind; cwd: string; row: ExtensionRow; detail: ExtensionDetail; onClose: () => void; onSaved: () => void }) {
  const initialObject = useMemo(() => parseObject(detail.content), [detail.content]);
  const initialMcpConfig = useMemo(() => isRecord(initialObject?.['config']) ? initialObject['config'] : {}, [initialObject]);
  const [content, setContent] = useState(detail.content);
  const [mcpType, setMcpType] = useState(readString(initialMcpConfig['type']) ?? 'http');
  const [mcpUrl, setMcpUrl] = useState(readString(initialMcpConfig['url']) ?? '');
  const [pluginVersion, setPluginVersion] = useState(readString(initialObject?.['version']) ?? '');
  const [pluginDescription, setPluginDescription] = useState(readString(initialObject?.['description']) ?? '');
  const initialHook = useMemo(() => parseHook(initialObject), [initialObject]);
  const [hookEvent, setHookEvent] = useState<DesktopHookEvent>(initialHook.event);
  const [hookCommand, setHookCommand] = useState(initialHook.command);
  const [hookArgs, setHookArgs] = useState(initialHook.args.join(', '));
  const [hookTimeout, setHookTimeout] = useState(String(initialHook.timeoutMs));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const editable = detail.editable;
  const validationErrors: ValidationErrors = !editable ? {} : kind === 'hook' ? validateHookFields(hookCommand, hookArgs, hookTimeout) : kind === 'mcp' ? validateMcpFields(mcpType, mcpUrl) : kind === 'skill' && detail.format === 'markdown' ? validateContent(content) : {};
  const save = async () => {
    const validationError = firstValidationError(validationErrors);
    if (validationError !== undefined) { setError(validationError); return; }
    setSaving(true); setError(undefined);
    try {
      const nextContent = kind === 'mcp'
        ? JSON.stringify({ ...(initialObject ?? {}), config: { ...initialMcpConfig, type: mcpType, url: mcpUrl } }, null, 2)
        : kind === 'plugin'
          ? JSON.stringify({ ...(initialObject ?? {}), version: pluginVersion, description: pluginDescription }, null, 2)
          : kind === 'hook'
            ? JSON.stringify({ event: hookEvent, command: hookCommand, args: parseArgs(hookArgs), timeoutMs: Number(hookTimeout) }, null, 2)
            : content;
      await window.lotagate.extensions.writeDetail({ kind, cwd, name: row.name, ...(row.scope === undefined ? {} : { scope: row.scope }), content: nextContent });
      onSaved();
    } catch (reason) { setError(toMessage(reason)); }
    finally { setSaving(false); }
  };
  const subtitle = detail.fileName === undefined ? {} : { subtitle: detail.fileName };
  return <Modal title={row.name} {...subtitle} className="extension-detail-dialog" onClose={onClose}><Scrollbar className="extension-detail-scrollbar"><div className="extension-detail-modal">{kind === 'mcp' ? <McpDetailFields type={mcpType} url={mcpUrl} errors={validationErrors} editable={editable} onType={setMcpType} onUrl={setMcpUrl} {...(row.scope === undefined ? {} : { scope: row.scope })} /> : kind === 'plugin' ? <PluginDetailFields version={pluginVersion} description={pluginDescription} editable={editable} onVersion={setPluginVersion} onDescription={setPluginDescription} /> : kind === 'hook' ? <HookDetailFields event={hookEvent} command={hookCommand} args={hookArgs} timeoutMs={hookTimeout} errors={validationErrors} editable={editable} onEvent={setHookEvent} onCommand={setHookCommand} onArgs={setHookArgs} onTimeout={setHookTimeout} /> : kind === 'skill' && detail.format === 'markdown' ? editable ? <Field label="Skill content (Markdown)" error={validationErrors['content']}><TextArea className="extension-detail-editor" value={content} onChange={event => setContent(event.target.value)} spellCheck={false} /></Field> : <div className="extension-markdown-preview"><AgentMarkdown content={content} /></div> : <pre className="extension-text-preview">{content}</pre>}{error ? <p className="field-error">{error}</p> : null}</div></Scrollbar><div className="modal-actions"><Button variant="secondary" onClick={onClose}>Close</Button>{editable ? <Button variant="primary" disabled={saving || firstValidationError(validationErrors) !== undefined} onClick={() => void save()}>{saving ? 'Saving…' : 'Save changes'}</Button> : null}</div></Modal>;
}

function HookDetailFields({ event, command, args, timeoutMs, errors, editable, onEvent, onCommand, onArgs, onTimeout }: { event: DesktopHookEvent; command: string; args: string; timeoutMs: string; errors: ValidationErrors; editable: boolean; onEvent: (value: DesktopHookEvent) => void; onCommand: (value: string) => void; onArgs: (value: string) => void; onTimeout: (value: string) => void }) {
  return <div className="extension-detail-fields extension-detail-hook-fields"><Field label="Event"><Dropdown value={event} options={hookEventOptions} disabled={!editable} onChange={value => onEvent(value as DesktopHookEvent)} /></Field><Field label="Command" required error={errors['command']}><TextInput value={command} readOnly={!editable} placeholder="node" onChange={eventValue => onCommand(eventValue.target.value)} /></Field><Field label="Args (comma-separated)" error={errors['args']}><TextInput value={args} readOnly={!editable} placeholder="script.js, --check" onChange={eventValue => onArgs(eventValue.target.value)} /></Field><Field label="Timeout (ms)" required error={errors['timeoutMs']}><TextInput type="number" min={100} max={120000} step={1} value={timeoutMs} readOnly={!editable} onChange={eventValue => onTimeout(eventValue.target.value)} /></Field></div>;
}

function McpDetailFields({ type, url, scope, errors, editable, onType, onUrl }: { type: string; url: string; scope?: ExtensionScope; errors: ValidationErrors; editable: boolean; onType: (value: string) => void; onUrl: (value: string) => void }) {
  const typeOptions = [...new Set(['http', 'sse', type])].map(value => ({ value, label: value.toUpperCase() }));
  return <div className="extension-detail-fields extension-detail-mcp-fields"><Field label="Type"><Dropdown value={type} options={typeOptions} disabled={!editable} onChange={onType} /></Field><Field label="Scope"><span className="extension-detail-static">{scope ?? 'workspace'}</span></Field><Field label="Server URL" required error={errors['url']}><TextInput value={url} readOnly={!editable} onChange={event => onUrl(event.target.value)} /></Field></div>;
}

function PluginDetailFields({ version, description, editable, onVersion, onDescription }: { version: string; description: string; editable: boolean; onVersion: (value: string) => void; onDescription: (value: string) => void }) {
  return <div className="extension-detail-fields"><Field label="Version"><TextInput value={version} readOnly={!editable} onChange={event => onVersion(event.target.value)} /></Field><Field label="Description"><TextInput value={description} readOnly={!editable} onChange={event => onDescription(event.target.value)} /></Field></div>;
}

function HookAddModal({ busy, onClose, onSubmit }: { busy: boolean; onClose: () => void; onSubmit: (value: { name: string; event: DesktopHookEvent; command: string; args: string[]; timeoutMs: number }) => void }) {
  const [name, setName] = useState('');
  const [event, setEvent] = useState<DesktopHookEvent>('session.start');
  const [command, setCommand] = useState('');
  const [args, setArgs] = useState('');
  const [timeoutMs, setTimeoutMs] = useState('10000');
  const [submitted, setSubmitted] = useState(false);
  const errors: ValidationErrors = { name: validateHookName(name), ...validateHookFields(command, args, timeoutMs) };
  const valid = firstValidationError(errors) === undefined;
  const submit = () => { setSubmitted(true); if (!valid) return; onSubmit({ name: name.trim(), event, command: command.trim(), args: parseArgs(args), timeoutMs: Number(timeoutMs) }); };
  const visibleErrors = submitted ? errors : { name: name.trim() ? errors['name'] : undefined, command: command.trim() ? errors['command'] : undefined, args: args.trim() ? errors['args'] : undefined, timeoutMs: timeoutMs.trim() ? errors['timeoutMs'] : undefined };
  return <Modal title="Add hook" onClose={onClose}><div className="modal-form"><Field label="Name" required error={visibleErrors['name']}><TextInput value={name} onChange={eventValue => setName(eventValue.target.value)} placeholder="audit-hook" autoFocus /></Field><HookDetailFields event={event} command={command} args={args} timeoutMs={timeoutMs} errors={visibleErrors} editable onEvent={setEvent} onCommand={setCommand} onArgs={setArgs} onTimeout={setTimeoutMs} /></div><div className="modal-actions"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button variant="primary" disabled={busy || !valid} onClick={submit}>{busy ? 'Adding…' : 'Add'}</Button></div></Modal>;
}

function parseObject(content: string): Record<string, unknown> | undefined { try { const value: unknown = JSON.parse(content); return isRecord(value) ? value : undefined; } catch { return undefined; } }
const hookEventOptions = ['session.start', 'prompt.before', 'tool.before', 'tool.after', 'response.after', 'session.end'].map(value => ({ value, label: value }));
function parseHook(value: Record<string, unknown> | undefined): { event: DesktopHookEvent; command: string; args: string[]; timeoutMs: number } {
  const event = hookEventOptions.some(option => option.value === value?.['event']) ? value?.['event'] as DesktopHookEvent : 'session.start';
  const command = readString(value?.['command']) ?? '';
  const rawArgs = value?.['args'];
  const args = Array.isArray(rawArgs) ? rawArgs.filter((item): item is string => typeof item === 'string') : [];
  const timeoutMs = typeof value?.['timeoutMs'] === 'number' ? value['timeoutMs'] : 10000;
  return { event, command, args, timeoutMs };
}
function parseArgs(value: string): string[] { return value.split(',').map(item => item.trim()).filter(Boolean); }

function ExtensionListSkeleton() { return <div className="settings-extension-list">{[1, 2, 3].map(index => <Card className="settings-extension-row" key={index}><Skeleton className="settings-extension-skeleton" /></Card>)}</div>; }

function ExtensionAddModal({ kind, busy, onClose, onSubmit }: { kind: Exclude<ExtensionKind, 'hook'>; busy: boolean; onClose: () => void; onSubmit: (value: { invocation: CommandInvocation; message: string }) => void }) {
  const [name, setName] = useState('');
  const [source, setSource] = useState('');
  const [scope, setScope] = useState<ExtensionScope>('user');
  const [type, setType] = useState<'http' | 'sse'>('http');
  const [url, setUrl] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const title = kind === 'mcp' ? 'Add MCP server' : kind === 'plugin' ? 'Add plugin' : 'Add skill';
  const errors: ValidationErrors = kind === 'mcp' ? { name: validateExtensionName(name), url: validateMcpFields(type, url)['url'] } : { source: validateExtensionSource(source) };
  const valid = firstValidationError(errors) === undefined;
  const submitLabel = kind === 'mcp' ? 'Add' : 'Install';
  const busyLabel = kind === 'mcp' ? 'Adding…' : 'Installing…';
  const submit = () => {
    setSubmitted(true);
    if (!valid) return;
    if (kind === 'mcp') {
      onSubmit({ invocation: { actionId: 'mcp.add', positionals: [name.trim()], options: { type, url: url.trim(), scope } }, message: `Added MCP server ${name.trim()}` });
      return;
    }
    onSubmit({ invocation: { actionId: 'plugin.install', positionals: [source.trim()], options: { scope } }, message: `Added ${kind} from ${source.trim()}` });
  };
  return <Modal title={title} onClose={onClose}><div className="modal-form">{kind === 'mcp' ? <><Field label="Name" required error={submitted ? errors['name'] : undefined}><TextInput value={name} onChange={event => setName(event.target.value)} placeholder="my-mcp-server" autoFocus /></Field><Field label="Type"><Dropdown value={type} options={[{ value: 'http', label: 'HTTP' }, { value: 'sse', label: 'SSE' }]} onChange={value => setType(value as 'http' | 'sse')} /></Field><Field label="Scope"><Dropdown value={scope} options={scopeOptions} onChange={value => setScope(value as ExtensionScope)} /></Field><Field label="Server URL" required error={submitted ? errors['url'] : undefined}><TextInput value={url} onChange={event => setUrl(event.target.value)} placeholder="https://example.com/mcp" /></Field></> : <><Field label="Source" required error={submitted ? errors['source'] : undefined}><TextInput value={source} onChange={event => setSource(event.target.value)} placeholder="Path or URL" autoFocus /></Field><Field label="Scope"><Dropdown value={scope} options={scopeOptions} onChange={value => setScope(value as ExtensionScope)} /></Field></>}</div><div className="modal-actions"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button variant="primary" disabled={busy || !valid} onClick={submit}>{busy ? busyLabel : submitLabel}</Button></div></Modal>;
  return <Modal title={title} onClose={onClose}><div className="modal-form">{kind === 'mcp' ? <><Field label="Name" required error={submitted ? errors['name'] : undefined}><TextInput value={name} onChange={event => setName(event.target.value)} placeholder="my-mcp-server" autoFocus /></Field><Field label="Type"><Dropdown value={type} options={[{ value: 'http', label: 'HTTP' }, { value: 'sse', label: 'SSE' }]} onChange={value => setType(value as 'http' | 'sse')} /></Field><Field label="Scope"><Dropdown value={scope} options={scopeOptions} onChange={value => setScope(value as ExtensionScope)} /></Field><Field label="Server URL" required error={submitted ? errors['url'] : undefined}><TextInput value={url} onChange={event => setUrl(event.target.value)} placeholder="https://example.com/mcp" /></Field></> : <><Field label="Source" required error={submitted ? errors['source'] : undefined}><TextInput value={source} onChange={event => setSource(event.target.value)} placeholder="Path or URL" autoFocus /></Field><Field label="Scope"><Dropdown value={scope} options={scopeOptions} onChange={value => setScope(value as ExtensionScope)} /></Field></>}</div><div className="modal-actions"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button variant="primary" disabled={busy || !valid} onClick={submit}>{busy ? busyLabel : submitLabel}</Button></div></Modal>;
}

const scopeOptions = [{ value: 'user', label: 'User' }, { value: 'project', label: 'Project' }];
function hasActionsForAdd(kind: ExtensionKind, actions: Set<string>): boolean { const action = ACTIONS[kind].add; return action !== undefined && actions.has(action); }

type ValidationErrors = Record<string, string | undefined>;

function validateHookName(value: string): string | undefined {
  const name = value.trim();
  const result = hookNameSchema.safeParse(name);
  return result.success ? undefined : result.error.issues[0]?.message;
}

function validateHookFields(command: string, args: string, timeoutMs: string): ValidationErrors {
  const result: ValidationErrors = {};
  const normalizedCommand = command.trim();
  const commandResult = z.string().min(1).max(512).safeParse(normalizedCommand);
  if (!commandResult.success) result['command'] = normalizedCommand ? 'Command must not exceed 512 characters.' : 'Command is required.';
  const parsedArgs = parseArgs(args);
  const argsResult = z.array(z.string().max(16_384)).max(128).safeParse(parsedArgs);
  if (!argsResult.success) result['args'] = parsedArgs.length > 128 ? 'Args must contain no more than 128 values.' : 'Each argument must not exceed 16,384 characters.';
  const timeoutResult = z.string().regex(/^\d+$/u).refine(value => Number.isSafeInteger(Number(value)) && Number(value) >= 100 && Number(value) <= 120_000).safeParse(timeoutMs.trim());
  if (!timeoutResult.success) result['timeoutMs'] = 'Timeout must be an integer between 100 and 120,000 ms.';
  return result;
}

function validateMcpFields(type: string, url: string): ValidationErrors {
  const normalized = url.trim();
  if (!z.string().min(1).safeParse(normalized).success) return { url: 'Server URL is required.' };
  return httpUrlSchema.safeParse(normalized).success ? {} : { url: 'Server URL must use HTTP or HTTPS.' };
}

function validateExtensionName(value: string): string | undefined {
  const name = value.trim().toLowerCase();
  const result = extensionNameSchema.safeParse(name);
  return result.success ? undefined : result.error.issues[0]?.message;
}

function validateExtensionSource(value: string): string | undefined {
  const source = value.trim();
  return z.string().min(1).max(4_096).safeParse(source).success ? undefined : source.length === 0 ? 'Source is required.' : 'Source must not exceed 4,096 characters.';
}

function validateContent(value: string): ValidationErrors {
  const result = maxUtf8Bytes(2 * 1024 * 1024).safeParse(value);
  return result.success ? {} : { content: 'Content must not exceed 2 MB.' };
}

function firstValidationError(errors: ValidationErrors): string | undefined { return Object.values(errors).find((value): value is string => value !== undefined); }
