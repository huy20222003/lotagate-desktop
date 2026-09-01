import type { ReactNode } from 'react';
import { RotateCcw, Square, X } from 'lucide-react';
import type { AutomationRun } from '../../../contracts/ipc/v1/automation.js';
import type { DesktopApprovalRequest } from '../../../contracts/ipc/v1/approval.js';
import { Badge, Button, Icon, Modal } from '../../components/ui.js';
import { formatTime } from '../../utils/time.js';
import { InlineApproval } from '../workspace/InlineApproval.js';
import { automationRunStatusTone, automationRunSummary } from './automation-view-utils.js';

interface AutomationRunDetailsModalProps {
  run: AutomationRun;
  busy: boolean;
  onClose: () => void;
  onCancel: () => Promise<void>;
  onRetry: () => Promise<void>;
  onReview: (approved: boolean) => Promise<void>;
  onApproval: (approvalId: string, approved: boolean) => Promise<void>;
}

export function AutomationRunDetailsModal({ run, busy, onClose, onCancel, onRetry, onReview, onApproval }: AutomationRunDetailsModalProps) {
  const approval = run.pendingApproval;
  return <Modal title="Automation run details" subtitle={`Run ${run.id}`} className="automation-run-details-modal" onClose={onClose}>
    <div className="automation-run-details-content">
      <div className="automation-run-details-status"><Badge tone={automationRunStatusTone(run.status)}>{run.status.replace('_', ' ')}</Badge><span>Attempt {run.attempt}</span><span>Review: {run.reviewStatus.replace('_', ' ')}</span></div>
      <dl className="automation-run-details-grid">
        <Detail label="Created" value={formatTime(run.createdAt, { dateStyle: 'medium', timeStyle: 'short' })} />
        <Detail label="Started" value={run.startedAt ? formatTime(run.startedAt, { dateStyle: 'medium', timeStyle: 'short' }) : 'Not started'} />
        <Detail label="Finished" value={run.finishedAt ? formatTime(run.finishedAt, { dateStyle: 'medium', timeStyle: 'short' }) : 'Not finished'} />
        <Detail label="Task" value={run.taskId ?? 'Not created'} />
        <Detail label="Session" value={run.sessionId ?? 'Not created'} />
        <Detail label="Branch" value={run.branch ?? 'Default (HEAD)'} />
        <Detail label="Execution workspace" value={run.executionCwd ?? 'Not available'} />
        <Detail label="Worktree" value={run.worktreePath ?? 'Current workspace'} />
      </dl>
      <DetailSection label="Summary"><p className="automation-run-details-copy">{automationRunSummary(run)}</p></DetailSection>
      {run.error ? <DetailSection label="Error"><p className="automation-run-details-copy automation-run-details-error">{run.error}</p></DetailSection> : null}
      {run.changedFiles.length > 0 ? <DetailSection label={`Changed files (${run.changedFiles.length})`}><DetailList items={run.changedFiles} /></DetailSection> : null}
      {run.artifactIds.length > 0 ? <DetailSection label={`Artifacts (${run.artifactIds.length})`}><DetailList items={run.artifactIds} /></DetailSection> : null}
      {approval ? <DetailSection label="Pending approval"><dl className="automation-run-details-grid"><Detail label="Tool" value={approval.toolName} /><Detail label="Display name" value={approval.displayName} /><Detail label="Kind" value={approval.kind} /><Detail label="Requested" value={formatTime(approval.requestedAt, { dateStyle: 'medium', timeStyle: 'short' })} /><Detail label="Execution boundary" value={approval.executionBoundary ?? 'Not specified'} /><Detail label="Fallback reason" value={approval.fallbackReason ?? 'None'} /></dl><pre className="automation-run-details-json">{JSON.stringify(approval.detail, null, 2)}</pre><InlineApproval request={automationApprovalRequest(run)} onDecision={approved => onApproval(approval.approvalId, approved)} /></DetailSection> : null}
    </div>
    <div className="modal-actions automation-run-details-actions">
      {run.status === 'running' ? <Button variant="danger" disabled={busy} onClick={() => void onCancel()}><Icon icon={Square} size={13} /> Cancel</Button> : null}
      {run.status === 'awaiting_review' ? <><Button variant="secondary" disabled={busy} onClick={() => void onReview(false)}><Icon icon={X} size={13} /> Reject</Button><Button variant="primary" disabled={busy} onClick={() => void onReview(true)}>Approve</Button></> : null}
      {['failed', 'timed_out', 'cancelled'].includes(run.status) ? <Button variant="secondary" disabled={busy} onClick={() => void onRetry()}><Icon icon={RotateCcw} size={13} /> Retry</Button> : null}
    </div>
  </Modal>;
}

function Detail({ label, value }: { label: string; value: string }) { return <div><dt>{label}</dt><dd title={value}>{value}</dd></div>; }

function DetailSection({ label, children }: { label: string; children: ReactNode }) { return <section className="automation-run-details-section"><h3>{label}</h3>{children}</section>; }

function DetailList({ items }: { items: string[] }) { return <ul className="automation-run-details-list">{items.map(item => <li key={item}>{item}</li>)}</ul>; }

function automationApprovalRequest(run: AutomationRun): DesktopApprovalRequest {
  const approval = run.pendingApproval;
  if (approval === undefined) throw new Error('Automation approval is missing.');
  return { approvalId: approval.approvalId, source: 'automation', surface: 'automation', requestedAt: approval.requestedAt, taskId: run.taskId ?? run.id, turnId: run.sessionId ?? approval.approvalId, toolName: approval.toolName, displayName: approval.displayName, kind: approval.kind, detail: approval.detail, risk: approval.fallbackReason === undefined ? 'normal' : 'elevated', ...(run.executionCwd === undefined ? {} : { workspaceCwd: run.executionCwd }), ...(approval.executionBoundary === undefined ? {} : { executionBoundary: approval.executionBoundary }), ...(approval.fallbackReason === undefined ? {} : { fallbackReason: approval.fallbackReason }) };
}
