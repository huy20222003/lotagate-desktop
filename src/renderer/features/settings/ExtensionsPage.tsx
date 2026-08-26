import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, CircleOff, Plus, Trash2 } from 'lucide-react';
import { Button, Card, Dropdown, EmptyState, Field, Modal, Skeleton, TextArea, TextInput, Tooltip, useToast } from '../../components/ui.js';
import { ExtensionCommandClient, type CommandInvocation, type ExtensionKind, type ExtensionRow, type ExtensionScope } from './extension-command-client.js';
import type { DesktopHookEvent, ExtensionDetail } from '../../../contracts/ipc/v1/extensions.js';
import { Pagination } from '../../components/Pagination.js';
import { AgentMarkdown } from '../workspace/markdown-renderer.js';

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
  const save = async () => {
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
  return <Modal title={row.name} {...subtitle} className="extension-detail-dialog" onClose={onClose}><div className="extension-detail-modal">{kind === 'mcp' ? <McpDetailFields type={mcpType} url={mcpUrl} editable={editable} onType={setMcpType} onUrl={setMcpUrl} {...(row.scope === undefined ? {} : { scope: row.scope })} /> : kind === 'plugin' ? <PluginDetailFields version={pluginVersion} description={pluginDescription} editable={editable} onVersion={setPluginVersion} onDescription={setPluginDescription} /> : kind === 'hook' ? <HookDetailFields event={hookEvent} command={hookCommand} args={hookArgs} timeoutMs={hookTimeout} editable={editable} onEvent={setHookEvent} onCommand={setHookCommand} onArgs={setHookArgs} onTimeout={setHookTimeout} /> : kind === 'skill' && detail.format === 'markdown' ? editable ? <Field label="Skill content (Markdown)"><TextArea className="extension-detail-editor" value={content} onChange={event => setContent(event.target.value)} spellCheck={false} /></Field> : <div className="extension-markdown-preview"><AgentMarkdown content={content} /></div> : <pre className="extension-text-preview">{content}</pre>}{error ? <p className="field-error">{error}</p> : null}</div><div className="modal-actions"><Button variant="secondary" onClick={onClose}>Close</Button>{editable ? <Button variant="primary" disabled={saving} onClick={() => void save()}>{saving ? 'Saving…' : 'Save changes'}</Button> : null}</div></Modal>;
}

function HookDetailFields({ event, command, args, timeoutMs, editable, onEvent, onCommand, onArgs, onTimeout }: { event: DesktopHookEvent; command: string; args: string; timeoutMs: string; editable: boolean; onEvent: (value: DesktopHookEvent) => void; onCommand: (value: string) => void; onArgs: (value: string) => void; onTimeout: (value: string) => void }) {
  return <div className="extension-detail-fields extension-detail-hook-fields"><Field label="Event"><Dropdown value={event} options={hookEventOptions} disabled={!editable} onChange={value => onEvent(value as DesktopHookEvent)} /></Field><Field label="Command"><TextInput value={command} readOnly={!editable} placeholder="node" onChange={eventValue => onCommand(eventValue.target.value)} /></Field><Field label="Args (comma-separated)"><TextInput value={args} readOnly={!editable} placeholder="script.js, --check" onChange={eventValue => onArgs(eventValue.target.value)} /></Field><Field label="Timeout (ms)"><TextInput type="number" min={100} max={120000} step={1} value={timeoutMs} readOnly={!editable} onChange={eventValue => onTimeout(eventValue.target.value)} /></Field></div>;
}

function McpDetailFields({ type, url, scope, editable, onType, onUrl }: { type: string; url: string; scope?: ExtensionScope; editable: boolean; onType: (value: string) => void; onUrl: (value: string) => void }) {
  const typeOptions = [...new Set(['http', 'sse', type])].map(value => ({ value, label: value.toUpperCase() }));
  return <div className="extension-detail-fields extension-detail-mcp-fields"><Field label="Type"><Dropdown value={type} options={typeOptions} disabled={!editable} onChange={onType} /></Field><Field label="Scope"><span className="extension-detail-static">{scope ?? 'workspace'}</span></Field><Field label="Server URL"><TextInput value={url} readOnly={!editable} onChange={event => onUrl(event.target.value)} /></Field></div>;
}

function PluginDetailFields({ version, description, editable, onVersion, onDescription }: { version: string; description: string; editable: boolean; onVersion: (value: string) => void; onDescription: (value: string) => void }) {
  return <div className="extension-detail-fields"><Field label="Version"><TextInput value={version} readOnly={!editable} onChange={event => onVersion(event.target.value)} /></Field><Field label="Description"><TextInput value={description} readOnly={!editable} onChange={event => onDescription(event.target.value)} /></Field></div>;
}

function HookAddModal({ busy, onClose, onSubmit }: { busy: boolean; onClose: () => void; onSubmit: (value: { event: DesktopHookEvent; command: string; args: string[]; timeoutMs: number }) => void }) {
  const [event, setEvent] = useState<DesktopHookEvent>('session.start');
  const [command, setCommand] = useState('');
  const [args, setArgs] = useState('');
  const [timeoutMs, setTimeoutMs] = useState('10000');
  const submit = () => { if (!command.trim()) return; onSubmit({ event, command: command.trim(), args: parseArgs(args), timeoutMs: Number(timeoutMs) }); };
  const valid = command.trim().length > 0 && Number.isInteger(Number(timeoutMs)) && Number(timeoutMs) >= 100 && Number(timeoutMs) <= 120000;
  return <Modal title="Add hook" onClose={onClose}><div className="modal-form"><Field label="Event"><Dropdown value={event} options={hookEventOptions} onChange={value => setEvent(value as DesktopHookEvent)} /></Field><Field label="Command"><TextInput value={command} onChange={eventValue => setCommand(eventValue.target.value)} placeholder="node" autoFocus /></Field><Field label="Args (comma-separated)"><TextInput value={args} onChange={eventValue => setArgs(eventValue.target.value)} placeholder="script.js, --check" /></Field><Field label="Timeout (ms)"><TextInput type="number" min={100} max={120000} step={1} value={timeoutMs} onChange={eventValue => setTimeoutMs(eventValue.target.value)} /></Field></div><div className="modal-actions"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button variant="primary" disabled={busy || !valid} onClick={submit}>{busy ? 'Adding…' : 'Add'}</Button></div></Modal>;
}

function parseObject(content: string): Record<string, unknown> | undefined { try { const value: unknown = JSON.parse(content); return isRecord(value) ? value : undefined; } catch { return undefined; } }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function readString(value: unknown): string | undefined { return typeof value === 'string' ? value : undefined; }
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
  const title = kind === 'mcp' ? 'Add MCP server' : kind === 'plugin' ? 'Add plugin' : 'Add skill';
  const submit = () => {
    if (kind === 'mcp') {
      if (!name.trim() || !url.trim()) return;
      onSubmit({ invocation: { actionId: 'mcp.add', positionals: [name.trim()], options: { type, url: url.trim(), scope } }, message: `Added MCP server ${name.trim()}` });
      return;
    }
    if (!source.trim()) return;
    onSubmit({ invocation: { actionId: 'plugin.install', positionals: [source.trim()], options: { scope } }, message: `Added ${kind} from ${source.trim()}` });
  };
  return <Modal title={title} onClose={onClose}><div className="modal-form">{kind === 'mcp' ? <><Field label="Name"><TextInput value={name} onChange={event => setName(event.target.value)} placeholder="my-mcp-server" autoFocus /></Field><Field label="Type"><Dropdown value={type} options={[{ value: 'http', label: 'HTTP' }, { value: 'sse', label: 'SSE' }]} onChange={value => setType(value as 'http' | 'sse')} /></Field><Field label="Scope"><Dropdown value={scope} options={scopeOptions} onChange={value => setScope(value as ExtensionScope)} /></Field><Field label="Server URL"><TextInput value={url} onChange={event => setUrl(event.target.value)} placeholder="https://example.com/mcp" /></Field></> : <><Field label="Source"><TextInput value={source} onChange={event => setSource(event.target.value)} placeholder="Path or URL" autoFocus /></Field><Field label="Scope"><Dropdown value={scope} options={scopeOptions} onChange={value => setScope(value as ExtensionScope)} /></Field></>}</div><div className="modal-actions"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button variant="primary" disabled={busy || (kind === 'mcp' ? !name.trim() || !url.trim() : !source.trim())} onClick={submit}>{busy ? 'Adding…' : 'Add'}</Button></div></Modal>;
}

const scopeOptions = [{ value: 'user', label: 'User' }, { value: 'project', label: 'Project' }];
function hasActionsForAdd(kind: ExtensionKind, actions: Set<string>): boolean { const action = ACTIONS[kind].add; return action !== undefined && actions.has(action); }
function toMessage(reason: unknown): string { return reason instanceof Error ? reason.message : 'The extension operation failed.'; }
