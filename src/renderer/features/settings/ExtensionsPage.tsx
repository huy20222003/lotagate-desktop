import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Plus, RefreshCw } from 'lucide-react';
import { Button, Card, EmptyState, IconButton, Modal, TextInput, useToast } from '../../components/ui.js';
import { ExtensionCommandClient, type CommandInvocation, type ExtensionKind, type ExtensionRow } from './extension-command-client.js';
import type { ExtensionDetail } from '../../../contracts/ipc/v1/extensions.js';
import { Pagination } from '../../components/Pagination.js';
import { toUserErrorMessage as toMessage } from '../../utils/errors.js';
import { ExtensionRowView } from './ExtensionRowView.js';
import { ExtensionDetailModal } from './ExtensionDetailModal.js';
import { ExtensionListSkeleton } from './ExtensionListSkeleton.js';
import { ExtensionAddModal } from './ExtensionAddModal.js';
import { HookAddModal } from './HookAddModal.js';
import type { ExtensionAddValue, EditableExtensionKind, HookAddValue } from './extensions-view-types.js';
import { useDebounce } from '../../hooks/use-debounce.js';
import { Icon } from '../../components/ui.js';
import type { McpRuntimeStatus } from '../workspace/mcp-status.js';

const EXTENSIONS_PAGE_SIZE = 10;
const PAGE_META: Record<ExtensionKind, { title: string; empty: string; addLabel: string; readOnly?: boolean }> = { hook: { title: 'Hooks', empty: 'No hooks are loaded for this trusted workspace.', addLabel: 'Add hook' }, skill: { title: 'Skills', empty: 'No skills are available.', addLabel: 'Add skill' }, plugin: { title: 'Plugins', empty: 'No plugins are installed.', addLabel: 'Add plugin' }, mcp: { title: 'MCP', empty: 'No MCP servers are configured.', addLabel: 'Add MCP server' } };
const ACTIONS: Record<ExtensionKind, { enable: string; disable: string; remove: string; add?: string }> = { hook: { enable: '', disable: '', remove: '' }, skill: { enable: 'skill.enable', disable: 'skill.disable', remove: 'skill.remove', add: 'plugin.install' }, plugin: { enable: 'plugin.enable', disable: 'plugin.disable', remove: 'plugin.uninstall', add: 'plugin.install' }, mcp: { enable: 'mcp.enable', disable: 'mcp.disable', remove: 'mcp.remove', add: 'mcp.add' } };

export function ExtensionsPage({ kind, cwd, trusted = false, mcpStatuses = {} }: { kind: ExtensionKind; cwd?: string; trusted?: boolean; mcpStatuses?: Record<string, McpRuntimeStatus> }) {
  const meta = PAGE_META[kind]; const client = useMemo(() => new ExtensionCommandClient(), []); const [rows, setRows] = useState<ExtensionRow[]>([]); const [availableActions, setAvailableActions] = useState<Set<string>>(new Set()); const [search, setSearch] = useState(''); const debouncedSearch = useDebounce(search, 180); const [loading, setLoading] = useState(Boolean(cwd)); const [error, setError] = useState<string | undefined>(); const [busy, setBusy] = useState<string | undefined>(); const [addOpen, setAddOpen] = useState(false); const [removeTarget, setRemoveTarget] = useState<ExtensionRow | undefined>(); const [detailTarget, setDetailTarget] = useState<{ row: ExtensionRow; detail: ExtensionDetail } | undefined>(); const { success } = useToast();
  const requestRef = useRef(0);
  const mountedRef = useRef(true);
  const contextKey = `${cwd ?? ''}:${kind}:${trusted ? 'trusted' : 'untrusted'}`;
  const contextKeyRef = useRef(contextKey);
  contextKeyRef.current = contextKey;
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);
  const reload = useCallback(async () => {
    const requestId = ++requestRef.current;
    const requestContext = contextKey;
    const isCurrent = () => mountedRef.current && requestId === requestRef.current && contextKeyRef.current === requestContext;
    if (!cwd) { if (isCurrent()) { setRows([]); setAvailableActions(new Set()); setLoading(false); } return; }
    setLoading(true); setError(undefined);
    try {
      const actions = await client.listCommands(cwd);
      if (trusted && actions.has('trust.grant')) await client.execute(cwd, { actionId: 'trust.grant', positionals: [], options: {} });
      const nextRows = await client.list(cwd, kind);
      if (!isCurrent()) return;
      setAvailableActions(actions); setRows(nextRows);
    } catch (reason) { if (isCurrent()) setError(toMessage(reason)); }
    finally { if (isCurrent()) setLoading(false); }
  }, [client, contextKey, cwd, kind, trusted]);
  useEffect(() => { void reload(); }, [reload]);
  const filteredRows = useMemo(() => { const query = debouncedSearch.trim().toLocaleLowerCase(); return query ? rows.filter(row => `${row.name} ${row.detail} ${row.status}`.toLocaleLowerCase().includes(query)) : rows; }, [rows, debouncedSearch]); const [page, setPage] = useState(1); useEffect(() => { setPage(1); }, [kind, debouncedSearch]); const visibleRows = useMemo(() => filteredRows.slice((page - 1) * EXTENSIONS_PAGE_SIZE, page * EXTENSIONS_PAGE_SIZE), [filteredRows, page]);
  const execute = useCallback(async (invocation: CommandInvocation, message: string) => { if (!cwd) return; setBusy(invocation.actionId + invocation.positionals.join(':')); setError(undefined); try { if (invocation.options['scope'] === 'project' && !trusted) throw new Error('Trust this workspace before changing project-scoped extensions.'); await client.execute(cwd, invocation); success(message); await reload(); } catch (reason) { setError(toMessage(reason)); } finally { setBusy(undefined); } }, [client, cwd, reload, success, trusted]);
  const changeEnabled = (row: ExtensionRow) => { const actionId = row.status === 'ENABLED' ? ACTIONS[kind].disable : ACTIONS[kind].enable; if (!actionId || !row.scope) return; void execute({ actionId, positionals: [row.name], options: { scope: row.scope } }, `${row.status === 'ENABLED' ? 'Disabled' : 'Enabled'} ${meta.title.toLocaleLowerCase().slice(0, -1)}`); };
  const remove = () => { if (!removeTarget) return; if (kind === 'hook') { if (!cwd || removeTarget.editable !== true) return; setRemoveTarget(undefined); setBusy(`remove:${removeTarget.name}`); void window.lotagate.extensions.removeHook({ cwd, name: removeTarget.name }).then(() => { success(`Removed ${removeTarget.name}`); return reload(); }).catch(reason => setError(toMessage(reason))).finally(() => setBusy(undefined)); return; } if (!ACTIONS[kind].remove || !removeTarget.scope) return; const actionId = ACTIONS[kind].remove; setRemoveTarget(undefined); void execute({ actionId, positionals: [removeTarget.name], options: { scope: removeTarget.scope } }, `Removed ${removeTarget.name}`); };
  const openDetails = async (row: ExtensionRow) => { if (!cwd) return; setError(undefined); try { const scope = kind === 'hook' ? row.editable === true ? 'project' : 'plugin' : row.scope; const detail = await window.lotagate.extensions.readDetail({ kind, cwd, name: row.name, ...(scope === undefined ? {} : { scope }) }); setDetailTarget({ row, detail }); } catch (reason) { setError(toMessage(reason)); } };
  const reconnect = () => { if (!cwd) return; void execute({ actionId: 'mcp.reload', positionals: [], options: {} }, 'MCP reconnect requested'); };
  const statusEntries = Object.entries(mcpStatuses);
  return <div className="settings-extension-page"><div className="settings-extension-toolbar"><TextInput value={search} onChange={event => setSearch(event.target.value)} placeholder={`Search ${meta.title.toLocaleLowerCase()}`} aria-label={`Search ${meta.title}`} />{kind === 'mcp' ? <Button variant="secondary" disabled={!cwd || busy !== undefined} onClick={reconnect}><Icon icon={RefreshCw} size={14} />Reconnect</Button> : null}<IconButton icon={Plus} iconSize={17} className="settings-extension-add" label={meta.addLabel} disabled={meta.readOnly || !cwd || (kind === 'hook' ? !trusted : !ACTIONS[kind].add || !hasActionsForAdd(kind, availableActions))} onClick={() => setAddOpen(true)} /></div>{kind === 'mcp' && statusEntries.length > 0 ? <Card className="settings-mcp-status"><strong>Runtime connections</strong><div className="settings-mcp-status-list">{statusEntries.map(([name, status]) => <div className="settings-mcp-status-row" key={name}><span><strong>{name}</strong><small>{status.toolCount === undefined ? 'Tool catalog not loaded' : `${status.toolCount} tool${status.toolCount === 1 ? '' : 's'}`}</small></span><span className={`settings-mcp-status-value settings-mcp-status-${status.status}`}>{status.status}{status.latencyMs === undefined ? '' : ` · ${status.latencyMs} ms`}{status.error ? ` · ${status.error}` : ''}</span></div>)}</div><small className="settings-muted">A failed server is retried automatically on the next agent turn or with Reconnect.</small></Card> : null}{error ? <Card className="settings-extension-error"><strong>Unable to load {meta.title.toLocaleLowerCase()}</strong><p>{error}</p></Card> : loading ? <ExtensionListSkeleton /> : filteredRows.length === 0 ? <EmptyState title={debouncedSearch ? 'No matching items' : meta.empty} /> : <><div className="settings-extension-list">{visibleRows.map(row => <ExtensionRowView row={row} busy={busy !== undefined} readOnly={meta.readOnly === true || row.scope === 'builtin' || (kind === 'hook' && row.editable !== true)} canToggle={kind !== 'hook'} canRemove={kind === 'hook' ? row.editable === true : true} onOpen={() => void openDetails(row)} onToggle={() => changeEnabled(row)} onRemove={() => setRemoveTarget(row)} key={`${row.name}:${row.scope ?? 'hook'}`} />)}</div><Pagination page={page} pageSize={EXTENSIONS_PAGE_SIZE} total={filteredRows.length} onPageChange={setPage} /></>}{addOpen && cwd && kind === 'hook' ? <HookAddModal busy={busy !== undefined} onClose={() => setAddOpen(false)} onSubmit={(input: HookAddValue) => { setAddOpen(false); setBusy('add:hook'); void window.lotagate.extensions.createHook({ cwd, ...input }).then(() => { success('Added hook'); return reload(); }).catch(reason => setError(toMessage(reason))).finally(() => setBusy(undefined)); }} /> : null}{addOpen && cwd && kind !== 'hook' ? <ExtensionAddModal kind={kind as EditableExtensionKind} busy={busy !== undefined} onClose={() => setAddOpen(false)} onSubmit={(input: ExtensionAddValue) => { setAddOpen(false); void execute(input.invocation, input.message); }} /> : null}{removeTarget ? <Modal title={`Remove ${meta.title.slice(0, -1)}`} onClose={() => setRemoveTarget(undefined)}><p className="modal-copy">Remove <strong>{removeTarget.name}</strong>{removeTarget.scope ? ` from ${removeTarget.scope} scope?` : '?'}</p><div className="modal-actions"><Button variant="secondary" onClick={() => setRemoveTarget(undefined)}>Cancel</Button><Button variant="danger" onClick={remove}>Remove</Button></div></Modal> : null}{detailTarget && cwd ? <ExtensionDetailModal kind={kind} cwd={cwd} row={detailTarget.row} detail={detailTarget.detail} onClose={() => { setDetailTarget(undefined); }} onSaved={() => { success(`Saved ${detailTarget.row.name}`); setDetailTarget(undefined); void reload(); }} /> : null}</div>;
}

function hasActionsForAdd(kind: ExtensionKind, actions: Set<string>): boolean { const action = ACTIONS[kind].add; return action !== undefined && actions.has(action); }
