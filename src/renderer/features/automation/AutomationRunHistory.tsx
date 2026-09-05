import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import type { AutomationRun } from '../../../contracts/ipc/v1/automation.js';
import { Badge, Button, Card, EmptyState, Icon, Skeleton, useToast } from '../../components/ui.js';
import { Scrollbar } from '../../components/Scrollbar.js';
import { Pagination } from '../../components/Pagination.js';
import { formatTime } from '../../utils/time.js';
import { formatTextClamp } from '../../utils/text.js';
import { toUserErrorMessage } from '../../utils/errors.js';
import { automationRunStatusTone, automationRunSummary } from './automation-view-utils.js';
import { AutomationRunDetailsModal } from './AutomationRunDetailsModal.js';

const RUN_PAGE_SIZE = 8;
const RUN_SUMMARY_LENGTH = 180;

interface AutomationRunHistoryProps {
  automationId: string;
  refreshToken: number;
  onCancel: (runId: string) => Promise<void>;
  onRetry: (runId: string) => Promise<void>;
  onReview: (runId: string, approved: boolean) => Promise<void>;
  onApproval: (runId: string, approvalId: string, approved: boolean) => Promise<void>;
}

export function AutomationRunHistory({ automationId, refreshToken, onCancel, onRetry, onReview, onApproval }: AutomationRunHistoryProps) {
  const [runs, setRuns] = useState<AutomationRun[]>([]);
  const [page, setPage] = useState(1);
  const [selectedRunId, setSelectedRunId] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState<string | undefined>();
  const { error: showError } = useToast();

  const reload = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      setRuns(await window.lotagate.automations.runs(automationId, 100));
    } catch (reason) {
      const message = toUserErrorMessage(reason, 'Unable to load run history.');
      setError(message);
      showError('Unable to load run history', message);
    } finally {
      setLoading(false);
    }
  }, [automationId, showError]);

  useEffect(() => {
    setPage(1);
    setSelectedRunId(undefined);
    void reload();
  }, [reload, refreshToken]);

  const visible = useMemo(() => runs.slice((page - 1) * RUN_PAGE_SIZE, page * RUN_PAGE_SIZE), [page, runs]);
  const selectedRun = selectedRunId === undefined ? undefined : runs.find(run => run.id === selectedRunId);
  const runAction = async (runId: string, action: (id: string) => Promise<void>) => {
    setBusy(runId);
    try {
      await action(runId);
      await reload();
      setSelectedRunId(undefined);
    } catch (reason) {
      const message = toUserErrorMessage(reason);
      setError(message);
      showError('Automation run operation failed', message);
    } finally {
      setBusy(undefined);
    }
  };

  if (loading) return <div className="automation-history-loading" aria-label="Loading automation runs">{[1, 2, 3].map(index => <Skeleton className="automation-history-skeleton" key={index} />)}</div>;
  if (error) return <EmptyState title="Unable to load run history" detail={error} action={<Button variant="secondary" onClick={() => void reload()}><Icon icon={RefreshCw} size={14} /> Retry</Button>} />;
  if (runs.length === 0) return <EmptyState title="No runs yet" detail="Run this automation manually or wait for its next scheduled time." />;

  return <>
    <div className="automation-history"><Scrollbar className="automation-history-scrollbar"><div className="automation-run-list">{visible.map(run => <AutomationRunCard key={run.id} run={run} onOpen={() => setSelectedRunId(run.id)} />)}</div></Scrollbar><Pagination page={page} pageSize={RUN_PAGE_SIZE} total={runs.length} onPageChange={setPage} /></div>
    {selectedRun ? <AutomationRunDetailsModal run={selectedRun} busy={busy === selectedRun.id} onClose={() => setSelectedRunId(undefined)} onCancel={() => runAction(selectedRun.id, onCancel)} onRetry={() => runAction(selectedRun.id, onRetry)} onReview={approved => runAction(selectedRun.id, id => onReview(id, approved))} onApproval={(approvalId, approved) => runAction(selectedRun.id, id => onApproval(id, approvalId, approved))} /> : null}
  </>;
}

function AutomationRunCard({ run, onOpen }: { run: AutomationRun; onOpen: () => void }) {
  const summary = automationRunSummary(run);
  return <Card className="automation-run-card"><button type="button" className="automation-run-summary" onClick={onOpen} aria-label={`View details for automation run ${run.id}`}>
    <span className="automation-run-heading"><Badge tone={automationRunStatusTone(run.status)}>{run.status.replace('_', ' ')}</Badge><span>Attempt {run.attempt}</span><time>{formatTime(run.createdAt, { dateStyle: 'medium', timeStyle: 'short' })}</time></span>
    <span className="automation-run-summary-text" title={summary}>{formatTextClamp(RUN_SUMMARY_LENGTH, summary)}</span>
    <span className="automation-run-meta">{run.changedFiles.length > 0 ? <span>{run.changedFiles.length} changed files</span> : null}{run.artifactIds.length > 0 ? <span>{run.artifactIds.length} artifacts</span> : null}<span>View full details</span></span>
  </button></Card>;
}
