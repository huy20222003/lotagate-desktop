import { useEffect, useMemo, useState } from 'react';
import { RefreshCw, RotateCcw, Square, X } from 'lucide-react';
import type { AutomationRun } from '../../../contracts/ipc/v1/automation.js';
import type { ApprovalRequest } from '../../../contracts/ipc/v1/workspace.js';
import { Badge, Button, Card, EmptyState, Icon, Spinner } from '../../components/ui.js';
import { Scrollbar } from '../../components/Scrollbar.js';
import { formatTime } from '../../utils/time.js';
import { toUserErrorMessage } from '../../utils/errors.js';
import { InlineApproval } from '../workspace/InlineApproval.js';

const RUN_PAGE_SIZE = 8;

export function AutomationRunHistory({ automationId, refreshToken, onCancel, onRetry, onReview, onApproval }: { automationId: string; refreshToken: number; onCancel: (runId: string) => Promise<void>; onRetry: (runId: string) => Promise<void>; onReview: (runId: string, approved: boolean) => Promise<void>; onApproval: (runId: string, approvalId: string, approved: boolean) => Promise<void> }) {
  const [runs, setRuns] = useState<AutomationRun[]>([]);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState<string | undefined>();
  const reload = async () => { setLoading(true); setError(undefined); try { setRuns(await window.lotagate.automations.runs(automationId, 100)); } catch (reason) { setError(toUserErrorMessage(reason, 'Unable to load run history.')); } finally { setLoading(false); } };
  useEffect(() => { setPage(1); void reload(); }, [automationId, refreshToken]);
  const pageCount = Math.max(1, Math.ceil(runs.length / RUN_PAGE_SIZE));
  const visible = useMemo(() => runs.slice((page - 1) * RUN_PAGE_SIZE, page * RUN_PAGE_SIZE), [page, runs]);
  const runAction = async (runId: string, action: (id: string) => Promise<void>) => { setBusy(runId); try { await action(runId); await reload(); } catch (reason) { setError(toUserErrorMessage(reason)); } finally { setBusy(undefined); } };
  if (loading) return <div className="automation-history-loading"><Spinner /></div>;
  if (error) return <Card className="settings-extension-error"><strong>Unable to load run history</strong><p>{error}</p><Button variant="secondary" onClick={() => void reload()}><Icon icon={RefreshCw} size={14} /> Retry</Button></Card>;
  if (runs.length === 0) return <EmptyState title="No runs yet" detail="Run this automation manually or wait for its next scheduled time." />;
  return <div className="automation-history"><Scrollbar className="automation-history-scrollbar"><div className="automation-run-list">{visible.map(run => <Card className="automation-run-card" key={run.id}><div className="automation-run-main"><div className="automation-run-heading"><Badge tone={statusTone(run.status)}>{run.status.replace('_', ' ')}</Badge><span>Attempt {run.attempt}</span><time>{formatTime(run.createdAt, { dateStyle: 'medium', timeStyle: 'short' })}</time></div><p>{run.pendingApproval ? `${run.pendingApproval.displayName} is waiting for your approval.` : run.summary ?? run.error ?? 'No summary was returned.'}</p><div className="automation-run-meta">{run.taskId ? <span>Task {run.taskId.slice(0, 8)}</span> : null}{run.sessionId ? <span>Session {run.sessionId.slice(0, 8)}</span> : null}{run.changedFiles.length > 0 ? <span>{run.changedFiles.length} changed files</span> : null}{run.artifactIds.length > 0 ? <span>{run.artifactIds.length} artifacts</span> : null}</div></div>{run.status === 'awaiting_approval' && run.pendingApproval ? <InlineApproval request={automationApprovalRequest(run)} onDecision={approved => runAction(run.id, id => onApproval(id, run.pendingApproval!.approvalId, approved))} /> : null}<div className="automation-run-actions">{run.status === 'running' ? <Button variant="danger" disabled={busy === run.id} onClick={() => void runAction(run.id, onCancel)}><Icon icon={Square} size={13} /> Cancel</Button> : null}{run.status === 'awaiting_review' ? <><Button variant="secondary" disabled={busy === run.id} onClick={() => void runAction(run.id, id => onReview(id, false))}><Icon icon={X} size={13} /> Reject</Button><Button variant="primary" disabled={busy === run.id} onClick={() => void runAction(run.id, id => onReview(id, true))}>Approve</Button></> : null}{['failed', 'timed_out', 'cancelled'].includes(run.status) ? <Button variant="secondary" disabled={busy === run.id} onClick={() => void runAction(run.id, onRetry)}><Icon icon={RotateCcw} size={13} /> Retry</Button> : null}</div></Card>)}</div></Scrollbar>{pageCount > 1 ? <div className="automation-history-pagination"><Button variant="ghost" disabled={page === 1} onClick={() => setPage(current => current - 1)}>Previous</Button><span>Page {page} of {pageCount}</span><Button variant="ghost" disabled={page === pageCount} onClick={() => setPage(current => current + 1)}>Next</Button></div> : null}</div>;
}

function automationApprovalRequest(run: AutomationRun): ApprovalRequest {
  const approval = run.pendingApproval;
  if (approval === undefined) throw new Error('Automation approval is missing.');
  return { approvalId: approval.approvalId, taskId: run.taskId ?? run.id, turnId: run.sessionId ?? approval.approvalId, toolName: approval.toolName, displayName: approval.displayName, kind: approval.kind, detail: approval.detail, ...(approval.executionBoundary === undefined ? {} : { executionBoundary: approval.executionBoundary }), ...(approval.fallbackReason === undefined ? {} : { fallbackReason: approval.fallbackReason }) };
}

function statusTone(status: AutomationRun['status']): 'success' | 'warning' | 'danger' | 'neutral' { if (status === 'succeeded') return 'success'; if (status === 'awaiting_review' || status === 'awaiting_approval' || status === 'queued' || status === 'running') return 'warning'; if (status === 'failed' || status === 'timed_out') return 'danger'; return 'neutral'; }
