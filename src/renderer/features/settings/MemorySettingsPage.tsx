import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Download, Eye, Trash2, Upload } from 'lucide-react';
import { Button, Card, Dropdown, EmptyState, Icon, IconButton, Modal, Skeleton, Table, TextInput, useToast } from '../../components/ui.js';
import { Pagination } from '../../components/Pagination.js';
import { useDebounce } from '../../hooks/use-debounce.js';
import { toUserErrorMessage } from '../../utils/errors.js';
import { formatTextClamp } from '../../utils/text.js';
import { MemoryCommandClient, type MemoryRow } from './memory-command-client.js';

const ALL_FILTER_VALUE = 'all';
const MEMORY_PAGE_SIZE = 10;
export const MEMORY_STATEMENT_PREVIEW_LENGTH = 96;

export function MemorySettingsPage({ cwd, refreshToken = 0 }: { cwd?: string; refreshToken?: number }) {
  const client = useMemo(() => new MemoryCommandClient(), []);
  const currentCwdRef = useRef(cwd);
  const requestRef = useRef(0);
  currentCwdRef.current = cwd;
  const [rows, setRows] = useState<MemoryRow[]>([]);
  const [loading, setLoading] = useState(Boolean(cwd));
  const [busy, setBusy] = useState(false);
  const [clearRequested, setClearRequested] = useState(false);
  const [selected, setSelected] = useState<MemoryRow | undefined>();
  const [search, setSearch] = useState('');
  const [kindFilter, setKindFilter] = useState('all');
  const [page, setPage] = useState(1);
  const debouncedSearch = useDebounce(search, 180);
  const { success, error: showError } = useToast();
  const showErrorRef = useRef(showError);
  showErrorRef.current = showError;

  const reload = useCallback(async () => {
    const requestId = ++requestRef.current;
    const requestCwd = cwd;
    const isCurrent = () => requestId === requestRef.current && currentCwdRef.current === requestCwd;
    if (!requestCwd) {
      if (isCurrent()) { setRows([]); setLoading(false); }
      return;
    }
    setLoading(true);
    try {
      const project = await client.list(requestCwd);
      if (isCurrent()) setRows(project);
    } catch (reason) {
      if (isCurrent()) showErrorRef.current('Unable to load memory', toUserErrorMessage(reason));
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, [client, cwd, refreshToken]);

  useEffect(() => {
    void reload();
    return () => { requestRef.current += 1; };
  }, [reload]);

  useEffect(() => {
    setBusy(false);
    setClearRequested(false);
    setSelected(undefined);
  }, [cwd]);

  const isCurrentCwd = (requestCwd: string | undefined) => currentCwdRef.current === requestCwd;
  const forget = async (row: MemoryRow) => {
    const requestCwd = cwd;
    if (!requestCwd) return;
    setBusy(true);
    try {
      await client.forget(requestCwd, row.id);
      if (!isCurrentCwd(requestCwd)) return;
      success('Memory removed');
      await reload();
    } catch (reason) { if (isCurrentCwd(requestCwd)) showError('Unable to forget memory', toUserErrorMessage(reason)); }
    finally { if (isCurrentCwd(requestCwd)) setBusy(false); }
  };
  const show = async (row: MemoryRow) => {
    const requestCwd = cwd;
    if (!requestCwd) return;
    setBusy(true);
    try {
      const result = await client.show(requestCwd, row.id);
      if (isCurrentCwd(requestCwd)) setSelected(result ?? row);
    } catch (reason) { if (isCurrentCwd(requestCwd)) showError('Unable to show memory', toUserErrorMessage(reason)); }
    finally { if (isCurrentCwd(requestCwd)) setBusy(false); }
  };
  const clear = async () => {
    const requestCwd = cwd;
    if (!requestCwd || !clearRequested) return;
    setBusy(true);
    try {
      const count = await client.clear(requestCwd);
      if (!isCurrentCwd(requestCwd)) return;
      success(`Cleared ${count} memories`);
      setClearRequested(false);
      await reload();
    } catch (reason) { if (isCurrentCwd(requestCwd)) showError('Unable to clear memory', toUserErrorMessage(reason)); }
    finally { if (isCurrentCwd(requestCwd)) setBusy(false); }
  };
  const exportMemory = async () => {
    const requestCwd = cwd;
    if (!requestCwd) return;
    setBusy(true);
    try {
      const destination = await window.lotagate.workspaces.pickSaveFile(undefined, ['json']);
      if (destination === null || !isCurrentCwd(requestCwd)) return;
      await client.export(requestCwd, destination);
      if (isCurrentCwd(requestCwd)) success('Memory exported');
    } catch (reason) { if (isCurrentCwd(requestCwd)) showError('Unable to export memory', toUserErrorMessage(reason)); }
    finally { if (isCurrentCwd(requestCwd)) setBusy(false); }
  };
  const importMemory = async () => {
    const requestCwd = cwd;
    if (!requestCwd) return;
    setBusy(true);
    try {
      const selectedPath = await window.lotagate.workspaces.pickFile(undefined, ['json']);
      if (selectedPath === null || !isCurrentCwd(requestCwd)) return;
      const records = await client.previewImport(requestCwd, selectedPath);
      if (!isCurrentCwd(requestCwd)) return;
      if (records === 0) { success('No memories to import'); return; }
      const result = await client.import(requestCwd, selectedPath);
      if (!isCurrentCwd(requestCwd)) return;
      success(`Imported ${result.imported}; skipped ${result.skipped}`, `Validated ${records} memory records.`);
      await reload();
    } catch (reason) { if (isCurrentCwd(requestCwd)) showError('Unable to import memory', toUserErrorMessage(reason)); }
    finally { if (isCurrentCwd(requestCwd)) setBusy(false); }
  };

  const filteredRows = useMemo(() => {
    const query = debouncedSearch.trim().toLocaleLowerCase();
    return rows.filter(row => {
      const matchesQuery = query.length === 0 || `${row.statement} ${row.rationale ?? ''} ${row.evidenceRefs.join(' ')}`.toLocaleLowerCase().includes(query);
      const matchesKind = kindFilter === 'all' || row.kind === kindFilter;
      return matchesQuery && matchesKind;
    });
  }, [debouncedSearch, kindFilter, rows]);
  const kindOptions = useMemo(() => buildFilterOptions(rows.map(row => row.kind), 'All types'), [rows]);
  const pageCount = Math.max(1, Math.ceil(filteredRows.length / MEMORY_PAGE_SIZE));
  const visibleRows = useMemo(() => filteredRows.slice((page - 1) * MEMORY_PAGE_SIZE, page * MEMORY_PAGE_SIZE), [filteredRows, page]);
  useEffect(() => { setPage(1); }, [debouncedSearch, kindFilter]);
  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
    if (kindFilter !== ALL_FILTER_VALUE && !kindOptions.some(option => option.value === kindFilter)) setKindFilter(ALL_FILTER_VALUE);
  }, [kindFilter, kindOptions, page, pageCount]);

  if (!cwd) return <EmptyState title="Open a workspace to manage local memory" detail="Memory remains on this device. Project memories are scoped to the selected workspace." />;
  return <div className="settings-memory-page">
    <div className="settings-memory-toolbar"><TextInput value={search} onChange={event => setSearch(event.target.value)} placeholder="Search memories" aria-label="Search memories" /><Dropdown className="settings-memory-filter" ariaLabel="Filter memory type" placeholder="Filter type" value={kindFilter} options={kindOptions} onChange={setKindFilter} /><div className="settings-memory-actions"><Button variant="secondary" disabled={busy} onClick={() => void importMemory()}><Icon icon={Upload} size={14} />Import</Button><Button variant="secondary" disabled={busy} onClick={() => void exportMemory()}><Icon icon={Download} size={14} />Export</Button><Button variant="secondary" disabled={busy} onClick={() => setClearRequested(true)}><Icon icon={Trash2} size={14} />Clear</Button></div></div>
    {loading ? <MemoryTableSkeleton /> : <><Table columns={columns(show, forget, busy)} rows={visibleRows} emptyMessage={rows.length === 0 ? 'No local memories.' : 'No memories match the current filters.'} /><Pagination page={page} pageSize={MEMORY_PAGE_SIZE} total={filteredRows.length} onPageChange={setPage} /></>}
    {clearRequested ? <Modal title="Clear project memory" onClose={() => setClearRequested(false)}><p className="modal-copy">Remove all project memories from this device? This cannot be undone unless you exported a bundle first.</p><div className="modal-actions"><Button variant="secondary" disabled={busy} onClick={() => setClearRequested(false)}>Cancel</Button><Button variant="danger" disabled={busy} onClick={() => void clear()}>Clear memory</Button></div></Modal> : null}
    {selected === undefined ? null : <Modal title="Memory details" onClose={() => setSelected(undefined)}><p className="modal-copy">{selected.statement}</p>{selected.rationale === undefined ? null : <p className="modal-copy">{selected.rationale}</p>}<p className="modal-copy">{selected.kind} · {selected.state} · {selected.source}</p><p className="modal-copy">Topics: {selected.topics.length === 0 ? 'none' : selected.topics.join(', ')}</p><p className="modal-copy">Evidence: {selected.evidenceRefs.length === 0 ? 'none' : selected.evidenceRefs.join(', ')}</p><p className="modal-copy">Retrievals: {selected.retrievalCount}{selected.lastRetrievedAt === undefined ? '' : ` · last retrieved ${selected.lastRetrievedAt}`}</p><div className="modal-actions"><Button variant="secondary" onClick={() => setSelected(undefined)}>Close</Button></div></Modal>}
  </div>;
}

function MemoryTableSkeleton() {
  return <Card className="settings-memory-table-skeleton" aria-label="Loading local memory"><Skeleton className="settings-memory-skeleton-title" />{[1, 2, 3].map(index => <Skeleton className="settings-memory-skeleton-row" key={index} />)}</Card>;
}

function columns(onShow: (row: MemoryRow) => Promise<void>, onForget: (row: MemoryRow) => Promise<void>, busy: boolean) {
  return [
    { key: 'statement', label: 'Memory', render: (row: MemoryRow) => <span title={row.statement}>{formatTextClamp(MEMORY_STATEMENT_PREVIEW_LENGTH, row.statement)}</span> },
    { key: 'kind', label: 'Type' }, { key: 'state', label: 'State' }, { key: 'retrievalCount', label: 'Retrievals' },
    { key: 'actions', label: 'Actions', render: (row: MemoryRow) => <span><IconButton icon={Eye} iconSize={15} label={`Show ${row.statement}`} disabled={busy} onClick={() => void onShow(row)} /><IconButton icon={Trash2} iconSize={15} label={`Forget ${row.statement}`} disabled={busy} onClick={() => void onForget(row)} /></span> },
  ];
}

function buildFilterOptions(values: readonly string[], allLabel: string): Array<{ value: string; label: string }> {
  const uniqueValues = [...new Set(values)].sort((left, right) => left.localeCompare(right));
  if (uniqueValues.length === 0) return [];
  return [{ value: ALL_FILTER_VALUE, label: allLabel }, ...uniqueValues.map(value => ({ value, label: valueLabel(value) }))];
}

function valueLabel(value: string): string {
  return value.charAt(0).toLocaleUpperCase() + value.slice(1);
}
