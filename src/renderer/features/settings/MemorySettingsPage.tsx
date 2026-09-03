import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Download, Eye, RefreshCw, Trash2, Upload } from 'lucide-react';
import { Button, Card, EmptyState, Icon, IconButton, Modal, Skeleton, Table, TextInput, useToast } from '../../components/ui.js';
import { toUserErrorMessage } from '../../utils/errors.js';
import { MemoryCommandClient, type MemoryRow, type MemoryScope } from './memory-command-client.js';

export function MemorySettingsPage({ cwd }: { cwd?: string }) {
  const client = useMemo(() => new MemoryCommandClient(), []);
  const currentCwdRef = useRef(cwd);
  const requestRef = useRef(0);
  currentCwdRef.current = cwd;
  const [rows, setRows] = useState<MemoryRow[]>([]);
  const [loading, setLoading] = useState(Boolean(cwd));
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [clearScope, setClearScope] = useState<MemoryScope | undefined>();
  const [selected, setSelected] = useState<MemoryRow | undefined>();
  const [exportPath, setExportPath] = useState('');
  const [importPath, setImportPath] = useState('');
  const [importScope, setImportScope] = useState<MemoryScope>('project');
  const [importRecords, setImportRecords] = useState<number | undefined>();
  const { success } = useToast();

  const reload = useCallback(async () => {
    const requestId = ++requestRef.current;
    const requestCwd = cwd;
    const isCurrent = () => requestId === requestRef.current && currentCwdRef.current === requestCwd;
    if (!requestCwd) {
      if (isCurrent()) { setRows([]); setLoading(false); setError(undefined); }
      return;
    }
    setLoading(true);
    setError(undefined);
    try {
      const [user, project] = await Promise.all([client.list(requestCwd, 'user'), client.list(requestCwd, 'project')]);
      if (isCurrent()) setRows([...user, ...project]);
    } catch (reason) {
      if (isCurrent()) setError(toUserErrorMessage(reason));
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, [client, cwd]);

  useEffect(() => {
    void reload();
    return () => { requestRef.current += 1; };
  }, [reload]);

  useEffect(() => {
    setBusy(false);
    setClearScope(undefined);
    setSelected(undefined);
    setImportRecords(undefined);
  }, [cwd]);

  const isCurrentCwd = (requestCwd: string | undefined) => currentCwdRef.current === requestCwd;
  const forget = async (row: MemoryRow) => {
    const requestCwd = cwd;
    if (!requestCwd) return;
    setBusy(true); setError(undefined);
    try {
      await client.forget(requestCwd, row.scope, row.id);
      if (!isCurrentCwd(requestCwd)) return;
      success('Memory removed');
      await reload();
    } catch (reason) { if (isCurrentCwd(requestCwd)) setError(toUserErrorMessage(reason)); }
    finally { if (isCurrentCwd(requestCwd)) setBusy(false); }
  };
  const show = async (row: MemoryRow) => {
    const requestCwd = cwd;
    if (!requestCwd) return;
    setBusy(true); setError(undefined);
    try {
      const result = await client.show(requestCwd, row.scope, row.id);
      if (isCurrentCwd(requestCwd)) setSelected(result ?? row);
    } catch (reason) { if (isCurrentCwd(requestCwd)) setError(toUserErrorMessage(reason)); }
    finally { if (isCurrentCwd(requestCwd)) setBusy(false); }
  };
  const clear = async () => {
    const requestCwd = cwd;
    const scope = clearScope;
    if (!requestCwd || scope === undefined) return;
    setBusy(true); setError(undefined);
    try {
      const count = await client.clear(requestCwd, scope);
      if (!isCurrentCwd(requestCwd)) return;
      success(`Cleared ${count} ${scope} memories`);
      setClearScope(undefined);
      await reload();
    } catch (reason) { if (isCurrentCwd(requestCwd)) setError(toUserErrorMessage(reason)); }
    finally { if (isCurrentCwd(requestCwd)) setBusy(false); }
  };
  const exportMemory = async (scope: MemoryScope) => {
    const requestCwd = cwd;
    if (!requestCwd) return;
    setBusy(true); setError(undefined);
    try {
      await client.export(requestCwd, scope, exportPath.trim() || undefined);
      if (isCurrentCwd(requestCwd)) success(exportPath.trim() ? `Exported ${scope} memory bundle` : 'Memory bundle returned by the CLI command');
    } catch (reason) { if (isCurrentCwd(requestCwd)) setError(toUserErrorMessage(reason)); }
    finally { if (isCurrentCwd(requestCwd)) setBusy(false); }
  };
  const previewImport = async () => {
    const requestCwd = cwd;
    if (!requestCwd || importPath.trim().length === 0) return;
    setBusy(true); setError(undefined);
    try {
      const records = await client.previewImport(requestCwd, importScope, importPath.trim());
      if (isCurrentCwd(requestCwd)) setImportRecords(records);
    } catch (reason) { if (isCurrentCwd(requestCwd)) setError(toUserErrorMessage(reason)); }
    finally { if (isCurrentCwd(requestCwd)) setBusy(false); }
  };
  const applyImport = async () => {
    const requestCwd = cwd;
    if (!requestCwd || importPath.trim().length === 0) return;
    setBusy(true); setError(undefined);
    try {
      const result = await client.import(requestCwd, importScope, importPath.trim());
      if (!isCurrentCwd(requestCwd)) return;
      success(`Imported ${result.imported}; skipped ${result.skipped}`);
      setImportRecords(undefined);
      setImportPath('');
      await reload();
    } catch (reason) { if (isCurrentCwd(requestCwd)) setError(toUserErrorMessage(reason)); }
    finally { if (isCurrentCwd(requestCwd)) setBusy(false); }
  };

  if (!cwd) return <EmptyState title="Open a workspace to manage local memory" detail="Memory remains on this device. Project memories are scoped to the selected workspace." />;
  return <div className="settings-memory-page">
    <div className="settings-intro"><span className="settings-eyebrow">Local intelligence</span><h2>Agent memory</h2><p>Verified local outcomes can inform future agent turns. Imported bundles remain candidates until LotaGate verifies them locally.</p></div>
    <Card className="settings-form-card"><div className="settings-card-heading"><div><h3>Manage local memory</h3><p>Memory is stored on this device. Clearing a scope is permanent unless you export it first.</p></div></div><div className="settings-memory-toolbar"><Button variant="secondary" disabled={loading || busy} onClick={() => void reload()}><Icon icon={RefreshCw} size={14} />Refresh</Button><Button variant="secondary" disabled={busy} onClick={() => setClearScope('project')}><Icon icon={Trash2} size={14} />Clear project</Button><Button variant="secondary" disabled={busy} onClick={() => setClearScope('user')}><Icon icon={Trash2} size={14} />Clear user</Button></div></Card>
    {error ? <Card className="settings-extension-error"><strong>Memory action failed</strong><p>{error}</p></Card> : null}
    <Card className="settings-form-card"><div className="settings-memory-transfer"><TextInput value={exportPath} onChange={event => setExportPath(event.target.value)} placeholder="Optional absolute export path (.json)" aria-label="Memory export path" /><Button variant="secondary" disabled={busy} onClick={() => void exportMemory('project')}><Icon icon={Download} size={14} />Export project</Button><Button variant="secondary" disabled={busy} onClick={() => void exportMemory('user')}><Icon icon={Download} size={14} />Export user</Button></div><div className="settings-memory-transfer"><TextInput value={importPath} onChange={event => { setImportPath(event.target.value); setImportRecords(undefined); }} placeholder="Absolute memory bundle path (.json)" aria-label="Memory import path" /><select className="settings-memory-scope" value={importScope} onChange={event => { setImportScope(event.target.value === 'user' ? 'user' : 'project'); setImportRecords(undefined); }} aria-label="Memory import scope"><option value="project">Project</option><option value="user">User</option></select><Button variant="secondary" disabled={busy || importPath.trim().length === 0} onClick={() => void previewImport()}><Icon icon={Upload} size={14} />Validate import</Button>{importRecords === undefined ? null : <Button variant="primary" disabled={busy} onClick={() => void applyImport()}>Import {importRecords}</Button>}</div></Card>
    {loading ? <MemoryTableSkeleton /> : rows.length === 0 ? <EmptyState title="No local memories" detail="Verified task outcomes can be retained locally and managed here." /> : <Table columns={columns(show, forget, busy)} rows={rows} />}
    {clearScope === undefined ? null : <Modal title={`Clear ${clearScope} memory`} onClose={() => setClearScope(undefined)}><p className="modal-copy">Remove all {clearScope}-scoped memories from this device? This cannot be undone unless you exported a bundle first.</p><div className="modal-actions"><Button variant="secondary" disabled={busy} onClick={() => setClearScope(undefined)}>Cancel</Button><Button variant="danger" disabled={busy} onClick={() => void clear()}>Clear memory</Button></div></Modal>}
    {selected === undefined ? null : <Modal title="Memory details" onClose={() => setSelected(undefined)}><p className="modal-copy">{selected.statement}</p>{selected.rationale === undefined ? null : <p className="modal-copy">{selected.rationale}</p>}<p className="modal-copy">Scope: {selected.scope} · {selected.kind} · {selected.status} · used {selected.useCount} times</p><p className="modal-copy">Evidence: {selected.evidenceRefs.length === 0 ? 'none' : selected.evidenceRefs.join(', ')}</p><div className="modal-actions"><Button variant="secondary" onClick={() => setSelected(undefined)}>Close</Button></div></Modal>}
  </div>;
}

function MemoryTableSkeleton() {
  return <Card className="settings-memory-table-skeleton" aria-label="Loading local memory"><Skeleton className="settings-memory-skeleton-title" />{[1, 2, 3].map(index => <Skeleton className="settings-memory-skeleton-row" key={index} />)}</Card>;
}

function columns(onShow: (row: MemoryRow) => Promise<void>, onForget: (row: MemoryRow) => Promise<void>, busy: boolean) {
  return [
    { key: 'statement', label: 'Memory', render: (row: MemoryRow) => <span title={row.rationale}>{row.statement}</span> },
    { key: 'scope', label: 'Scope' }, { key: 'kind', label: 'Type' }, { key: 'status', label: 'Status' }, { key: 'useCount', label: 'Uses' },
    { key: 'actions', label: 'Actions', render: (row: MemoryRow) => <span><IconButton icon={Eye} iconSize={15} label={`Show ${row.statement}`} disabled={busy} onClick={() => void onShow(row)} /><IconButton icon={Trash2} iconSize={15} label={`Forget ${row.statement}`} disabled={busy} onClick={() => void onForget(row)} /></span> },
  ];
}
