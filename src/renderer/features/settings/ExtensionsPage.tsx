import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Plus, RefreshCw } from 'lucide-react';
import { Button, EmptyState, IconButton, Modal, TextInput, useToast } from '../../components/ui.js';
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

const EXTENSIONS_PAGE_SIZE = 40;
type ExtensionPageKind = Exclude<ExtensionKind, 'plugin'>;
const PAGE_META: Record<ExtensionPageKind, { title: string; empty: string; addLabel: string; readOnly?: boolean }> = { hook: { title: 'Hooks', empty: 'No hooks are loaded for this trusted workspace.', addLabel: 'Add hook' }, skill: { title: 'Skills', empty: 'No skills are available.', addLabel: 'Add skill' }, mcp: { title: 'MCP', empty: 'No MCP servers are configured.', addLabel: 'Add MCP server' } };
const ACTIONS: Record<ExtensionPageKind, { enable: string; disable: string; remove: string; add?: string }> = { hook: { enable: '', disable: '', remove: '' }, skill: { enable: 'skill.enable', disable: 'skill.disable', remove: 'skill.remove', add: 'plugin.install' }, mcp: { enable: 'mcp.enable', disable: 'mcp.disable', remove: 'mcp.remove', add: 'mcp.add' } };

export function ExtensionsPage({ kind, cwd, trusted = false }: { kind: ExtensionPageKind; cwd?: string; trusted?: boolean }) {
  const meta = PAGE_META[kind]; const client = useMemo(() => new ExtensionCommandClient(), []); const [rows, setRows] = useState<ExtensionRow[]>([]); const [availableActions, setAvailableActions] = useState<Set<string>>(new Set()); const [search, setSearch] = useState(''); const debouncedSearch = useDebounce(search, 180); const [loading, setLoading] = useState(Boolean(cwd)); const [busy, setBusy] = useState<string | undefined>(); const [addOpen, setAddOpen] = useState(false); const [removeTarget, setRemoveTarget] = useState<ExtensionRow | undefined>(); const [detailTarget, setDetailTarget] = useState<{ row: ExtensionRow; detail: ExtensionDetail } | undefined>(); const { success, error: showError } = useToast();
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
    setLoading(true);
    try {
      const actions = await client.listCommands(cwd);
      if (trusted && actions.has('trust.grant')) await client.execute(cwd, { actionId: 'trust.grant', positionals: [], options: {} });
      const nextRows = await client.list(cwd, kind);
      if (!isCurrent()) return;
      setAvailableActions(actions); setRows(nextRows);
    } catch (reason) { if (isCurrent()) showError(`Unable to load ${meta.title.toLocaleLowerCase()}`, toMessage(reason)); }
    finally { if (isCurrent()) setLoading(false); }
  }, [client, contextKey, cwd, kind, meta.title, showError, trusted]);
  useEffect(() => { void reload(); }, [reload]);
  const filteredRows = useMemo(() => { const query = debouncedSearch.trim().toLocaleLowerCase(); return query ? rows.filter(row => `${row.name} ${row.detail} ${row.status}`.toLocaleLowerCase().includes(query)) : rows; }, [rows, debouncedSearch]); const [page, setPage] = useState(1); useEffect(() => { setPage(1); }, [kind, debouncedSearch]); const visibleRows = useMemo(() => filteredRows.slice((page - 1) * EXTENSIONS_PAGE_SIZE, page * EXTENSIONS_PAGE_SIZE), [filteredRows, page]);
  const execute = useCallback(async (invocation: CommandInvocation, message: string) => { if (!cwd) return; setBusy(invocation.actionId + invocation.positionals.join(':')); try { if (invocation.options['scope'] === 'project' && !trusted) throw new Error('Trust this workspace before changing project-scoped extensions.'); await client.execute(cwd, invocation); success(message); await reload(); } catch (reason) { showError(`${meta.title} operation failed`, toMessage(reason)); } finally { setBusy(undefined); } }, [client, cwd, meta.title, reload, showError, success, trusted]);
  const changeEnabled = (row: ExtensionRow) => { const actionId = row.status === 'ENABLED' ? ACTIONS[kind].disable : ACTIONS[kind].enable; if (!actionId || !row.scope) return; void execute({ actionId, positionals: [row.name], options: { scope: row.scope } }, `${row.status === 'ENABLED' ? 'Disabled' : 'Enabled'} ${meta.title.toLocaleLowerCase().slice(0, -1)}`); };
  const remove = () => { if (!removeTarget || removeTarget.scope === 'plugin') return; if (kind === 'hook') { if (!cwd || removeTarget.editable !== true) return; setRemoveTarget(undefined); setBusy(`remove:${removeTarget.name}`); void window.lotagate.extensions.removeHook({ cwd, name: removeTarget.name }).then(() => { success(`Removed ${removeTarget.name}`); return reload(); }).catch(reason => showError('Hook removal failed', toMessage(reason))).finally(() => setBusy(undefined)); return; } if (!ACTIONS[kind].remove || !removeTarget.scope) return; const actionId = ACTIONS[kind].remove; setRemoveTarget(undefined); void execute({ actionId, positionals: [removeTarget.name], options: { scope: removeTarget.scope } }, `Removed ${removeTarget.name}`); };
  const openDetails = async (row: ExtensionRow) => { if (!cwd) return; try { const scope = kind === 'hook' ? row.editable === true ? 'project' : 'plugin' : row.scope; const detail = await window.lotagate.extensions.readDetail({ kind, cwd, name: row.name, ...(scope === undefined ? {} : { scope }), ...(row.pluginName === undefined ? {} : { pluginName: row.pluginName }), ...(row.pluginScope === undefined ? {} : { pluginScope: row.pluginScope }), ...(row.sourceName === undefined ? {} : { sourceName: row.sourceName }) }); setDetailTarget({ row, detail }); } catch (reason) { showError(`Unable to open ${meta.title.toLocaleLowerCase().replace(/s$/, '')}`, toMessage(reason)); } };
  const reconnect = () => { if (!cwd) return; void execute({ actionId: 'mcp.reload', positionals: [], options: {} }, 'MCP reconnect requested'); };
  return <div className="settings-extension-page"><div className="settings-extension-toolbar"><TextInput value={search} onChange={event => setSearch(event.target.value)} placeholder={`Search ${meta.title.toLocaleLowerCase()}`} aria-label={`Search ${meta.title}`} />{kind === 'mcp' ? <Button variant="secondary" disabled={!cwd || busy !== undefined} onClick={reconnect}><Icon icon={RefreshCw} size={14} />Reconnect</Button> : null}<IconButton icon={Plus} iconSize={17} className="settings-extension-add" label={meta.addLabel} disabled={meta.readOnly || !cwd || (kind === 'hook' ? !trusted : !ACTIONS[kind].add || !hasActionsForAdd(kind, availableActions))} onClick={() => setAddOpen(true)} /></div>{loading ? <ExtensionListSkeleton /> : filteredRows.length === 0 ? <EmptyState title={debouncedSearch ? 'No matching items' : meta.empty} /> : <><div className="settings-extension-list">{visibleRows.map(row => <ExtensionRowView kind={kind} row={row} busy={busy !== undefined} readOnly={meta.readOnly === true || row.scope === 'builtin' || row.scope === 'plugin' || (kind === 'hook' && row.editable !== true)} canToggle={kind !== 'hook' && row.scope !== 'plugin'} canRemove={kind === 'hook' ? row.editable === true : row.scope !== 'plugin'} onOpen={() => void openDetails(row)} onToggle={() => changeEnabled(row)} onRemove={() => setRemoveTarget(row)} key={`${row.name}:${row.scope ?? 'hook'}`} />)}</div><Pagination page={page} pageSize={EXTENSIONS_PAGE_SIZE} total={filteredRows.length} onPageChange={setPage} /></>}{addOpen && cwd && kind === 'hook' ? <HookAddModal busy={busy !== undefined} onClose={() => setAddOpen(false)} onSubmit={(input: HookAddValue) => { setAddOpen(false); setBusy('add:hook'); void window.lotagate.extensions.createHook({ cwd, ...input }).then(() => { success('Added hook'); return reload(); }).catch(reason => showError('Hook creation failed', toMessage(reason))).finally(() => setBusy(undefined)); }} /> : null}{addOpen && cwd && kind !== 'hook' ? <ExtensionAddModal kind={kind as EditableExtensionKind} busy={busy !== undefined} onClose={() => setAddOpen(false)} onSubmit={(input: ExtensionAddValue) => { setAddOpen(false); void execute(input.invocation, input.message); }} /> : null}{removeTarget ? <Modal title={`Remove ${meta.title.slice(0, -1)}`} onClose={() => setRemoveTarget(undefined)}><p className="modal-copy">Remove <strong>{removeTarget.name}</strong>{removeTarget.scope ? ` from ${removeTarget.scope} scope?` : '?'}</p><div className="modal-actions"><Button variant="secondary" onClick={() => setRemoveTarget(undefined)}>Cancel</Button><Button variant="danger" onClick={remove} /></div></Modal> : null}{detailTarget && cwd ? <ExtensionDetailModal kind={kind} cwd={cwd} row={detailTarget.row} detail={detailTarget.detail} onClose={() => { setDetailTarget(undefined); }} onSaved={() => { success(`Saved ${detailTarget.row.name}`); setDetailTarget(undefined); void reload(); }} /> : null}</div>;
}

function hasActionsForAdd(kind: ExtensionPageKind, actions: Set<string>): boolean { const action = ACTIONS[kind].add; return action !== undefined && actions.has(action); }
