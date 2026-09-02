import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pencil, Play, Plus, Power, PowerOff, Trash2 } from 'lucide-react';
import type { Automation, AutomationCreateInput } from '../../../contracts/ipc/v1/automation.js';
import type { Workspace } from '../../../contracts/ipc/v1/workspace.js';
import { Badge, Button, Card, EmptyState, Icon, IconButton, Modal, Skeleton, TextInput, useToast } from '../../components/ui.js';
import { Pagination } from '../../components/Pagination.js';
import { useDebounce } from '../../hooks/use-debounce.js';
import { toUserErrorMessage } from '../../utils/errors.js';
import { formatTextClamp } from '../../utils/text.js';
import { AutomationDetailsDrawer } from './AutomationDetailsDrawer.js';
import { AutomationFormModal } from './AutomationFormModal.js';
import { automationScheduleLabel } from './automation-view-utils.js';

const AUTOMATION_PAGE_SIZE = 8;
const AUTOMATION_LIST_TITLE_LENGTH = 64;

export function AutomationCenter({ workspaces }: { workspaces: Workspace[] }) {
  const [items, setItems] = useState<Automation[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [formTarget, setFormTarget] = useState<Automation | null>();
  const [removeTarget, setRemoveTarget] = useState<Automation>();
  const [busy, setBusy] = useState<string>();
  const [historyRefresh, setHistoryRefresh] = useState(0);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const debouncedSearch = useDebounce(search, 180);
  const { success } = useToast();

  const reload = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const next = await window.lotagate.automations.list();
      setItems(next);
      setSelectedId(current => current !== undefined && next.some(item => item.id === current) ? current : undefined);
    } catch (reason) {
      setError(toUserErrorMessage(reason, 'Unable to load automations.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
    return window.lotagate.automations.onState(event => {
      if (event.type === 'removed') {
        setItems(current => current.filter(item => item.id !== event.automationId));
        setSelectedId(current => current === event.automationId ? undefined : current);
      } else if (event.automation !== undefined) {
        setItems(current => current.some(item => item.id === event.automationId)
          ? current.map(item => item.id === event.automationId ? event.automation! : item)
          : [...current, event.automation!]);
      }
      setHistoryRefresh(current => current + 1);
    });
  }, [reload]);

  const filteredItems = useMemo(() => {
    const query = debouncedSearch.trim().toLocaleLowerCase();
    return query ? items.filter(item => item.name.toLocaleLowerCase().includes(query)) : items;
  }, [debouncedSearch, items]);
  const pageCount = Math.max(1, Math.ceil(filteredItems.length / AUTOMATION_PAGE_SIZE));
  const visibleItems = useMemo(() => filteredItems.slice((page - 1) * AUTOMATION_PAGE_SIZE, page * AUTOMATION_PAGE_SIZE), [filteredItems, page]);
  const selected = items.find(item => item.id === selectedId);

  useEffect(() => { setPage(1); }, [debouncedSearch]);
  useEffect(() => {
    if (filteredItems.length === 0) setSelectedId(undefined);
    else if (selectedId !== undefined && !filteredItems.some(item => item.id === selectedId)) setSelectedId(undefined);
    if (page > pageCount) setPage(pageCount);
  }, [filteredItems, page, pageCount, selectedId]);

  const workspaceName = (id: string) => workspaces.find(workspace => workspace.id === id)?.name ?? 'Workspace unavailable';
  const execute = async (key: string, operation: () => Promise<unknown>, message: string) => {
    setBusy(key);
    setError(undefined);
    try {
      await operation();
      success(message);
      await reload();
      setHistoryRefresh(current => current + 1);
    } catch (reason) {
      setError(toUserErrorMessage(reason));
    } finally {
      setBusy(undefined);
    }
  };
  const create = async (input: AutomationCreateInput) => { await window.lotagate.automations.create(input); setFormTarget(undefined); success('Automation created'); await reload(); };
  const update = async (input: AutomationCreateInput) => { if (!formTarget) return; await window.lotagate.automations.update(formTarget.id, input); setFormTarget(undefined); success('Automation updated'); await reload(); };
  const remove = async () => { if (!removeTarget) return; await execute(`remove:${removeTarget.id}`, () => window.lotagate.automations.remove(removeTarget.id), 'Automation deleted'); setRemoveTarget(undefined); };

  return <div className="automation-center">
    <div className="automation-toolbar">
      <TextInput value={search} onChange={event => setSearch(event.target.value)} placeholder="Search automations" aria-label="Search automations" />
      <Button variant="primary" onClick={() => setFormTarget(null)} disabled={workspaces.length === 0}><Icon icon={Plus} size={15} /> New automation</Button>
    </div>
    <p className="automation-intro settings-muted">Reliable, reviewable workflows that run in a trusted workspace.</p>
    {workspaces.length === 0 ? <Card className="settings-empty"><strong>Add a workspace first</strong><p>Automations need a workspace and its trust boundary before they can run.</p></Card> : null}
    {error ? <Card className="settings-extension-error"><strong>Automation operation failed</strong><p>{error}</p><Button variant="secondary" onClick={() => void reload()}>Retry</Button></Card> : null}
    {loading ? <div className="automation-list">{[1, 2, 3].map(index => <Card className="automation-list-item" key={index}><Skeleton className="automation-skeleton" /></Card>)}</div> : items.length === 0 && workspaces.length > 0 ? <EmptyState title="No automations yet" detail="Create a scheduled workflow for recurring checks, browser tasks, or project maintenance." action={<Button variant="secondary" onClick={() => setFormTarget(null)}><Icon icon={Plus} size={14} /> Create your first automation</Button>} /> : filteredItems.length === 0 ? <EmptyState title="No matching automations" detail="Try another automation name." /> : <div className="automation-layout">
      <section className="automation-list-column">
        <div className="automation-list">{visibleItems.map(item => <AutomationListItem key={item.id} automation={item} workspaceName={workspaceName(item.workspaceId)} selected={item.id === selectedId} busy={busy !== undefined} onSelect={() => setSelectedId(item.id)} onRun={() => void execute(item.id, () => window.lotagate.automations.run(item.id), 'Automation started')} onToggle={() => void execute(`toggle:${item.id}`, () => item.enabled ? window.lotagate.automations.pause(item.id) : window.lotagate.automations.resume(item.id), item.enabled ? 'Automation paused' : 'Automation resumed')} onEdit={() => setFormTarget(item)} onRemove={() => setRemoveTarget(item)} />)}</div>
        <Pagination page={page} pageSize={AUTOMATION_PAGE_SIZE} total={filteredItems.length} onPageChange={setPage} />
      </section>
      {selected ? <AutomationDetailsDrawer automation={selected} workspaceName={workspaceName(selected.workspaceId)} busy={busy !== undefined} refreshToken={historyRefresh} onClose={() => setSelectedId(undefined)} onRun={() => void execute(selected.id, () => window.lotagate.automations.run(selected.id), 'Automation started')} onCancel={runId => execute(`cancel:${runId}`, () => window.lotagate.automations.cancel(runId), 'Run cancelled')} onRetry={runId => execute(`retry:${runId}`, () => window.lotagate.automations.retry(runId), 'Run queued for retry')} onReview={(runId, approved) => execute(`review:${runId}`, () => window.lotagate.automations.review(runId, approved), approved ? 'Run approved' : 'Run rejected')} onApproval={(runId, approvalId, approved) => execute(`approval:${runId}`, () => window.lotagate.automations.approvalRespond(runId, approvalId, approved), approved ? 'Approval granted' : 'Approval denied')} /> : null}
    </div>}
    {formTarget !== undefined ? <AutomationFormModal key={formTarget?.id ?? 'new'} workspaces={workspaces} {...(formTarget ? { automation: formTarget } : {})} onClose={() => setFormTarget(undefined)} onSubmit={formTarget ? update : create} /> : null}
    {removeTarget ? <Modal title="Delete automation" onClose={() => setRemoveTarget(undefined)}><p className="modal-copy">Delete <strong>{removeTarget.name}</strong> and its local run history?</p><div className="modal-actions"><Button variant="secondary" onClick={() => setRemoveTarget(undefined)}>Cancel</Button><Button variant="danger" disabled={busy === `remove:${removeTarget.id}`} onClick={() => void remove()}>{busy === `remove:${removeTarget.id}` ? 'Deleting…' : 'Delete automation'}</Button></div></Modal> : null}
  </div>;
}

function AutomationListItem({ automation, workspaceName, selected, busy, onSelect, onRun, onToggle, onEdit, onRemove }: { automation: Automation; workspaceName: string; selected: boolean; busy: boolean; onSelect: () => void; onRun: () => void; onToggle: () => void; onEdit: () => void; onRemove: () => void }) {
  return <Card className={`automation-list-item${selected ? ' selected' : ''}`}>
    <button type="button" className="automation-list-item-main" onClick={onSelect}>
      <span className="automation-list-item-heading"><strong title={automation.name}>{formatTextClamp(AUTOMATION_LIST_TITLE_LENGTH, automation.name)}</strong><Badge tone={automation.enabled ? 'success' : 'neutral'}>{automation.enabled ? 'Enabled' : 'Paused'}</Badge></span>
      <small>{workspaceName} · {automationScheduleLabel(automation)}</small>
    </button>
    <div className="automation-item-actions">
      <IconButton icon={Pencil} iconSize={14} label={`Edit ${automation.name}`} disabled={busy} onClick={event => { event.stopPropagation(); onEdit(); }} />
      <IconButton icon={automation.enabled ? PowerOff : Power} iconSize={14} label={automation.enabled ? `Pause ${automation.name}` : `Resume ${automation.name}`} disabled={busy} onClick={event => { event.stopPropagation(); onToggle(); }} />
      <IconButton icon={Play} iconSize={14} label={`Run ${automation.name} now`} disabled={busy} onClick={event => { event.stopPropagation(); onRun(); }} />
      <IconButton icon={Trash2} iconSize={14} className="automation-item-danger" label={`Delete ${automation.name}`} disabled={busy} onClick={event => { event.stopPropagation(); onRemove(); }} />
    </div>
  </Card>;
}
