import { useRef, useState } from 'react';
import type { ApprovalRequest } from '../../../contracts/ipc/v1/workspace.js';
import { Button } from '../../components/ui.js';
import { formatToolDisplayName } from '../../../shared/tool-display.js';

export function InlineApproval({ request, onDecision }: { request: ApprovalRequest; onDecision: (approved: boolean) => Promise<void> }) {
  const [submitting, setSubmitting] = useState(false);
  const allowButtonRef = useRef<HTMLButtonElement>(null);
  const denyButtonRef = useRef<HTMLButtonElement>(null);
  const action = formatToolDisplayName(request.toolName, request.displayName).toLowerCase();
  const decide = async (approved: boolean) => { if (submitting) return; setSubmitting(true); try { await onDecision(approved); } finally { setSubmitting(false); } };
  const moveDecisionFocus = (direction: 'next' | 'previous') => { const active = document.activeElement; const next = direction === 'next' ? active === allowButtonRef.current ? denyButtonRef.current : allowButtonRef.current : active === denyButtonRef.current ? allowButtonRef.current : denyButtonRef.current; next?.focus(); };
  const boundary = request.executionBoundary === 'host' ? ' outside the sandbox' : '';
  return <section className="composer-approval" role="alertdialog" aria-labelledby="composer-approval-title" aria-describedby="composer-approval-summary" aria-busy={submitting} onKeyDown={event => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); moveDecisionFocus(event.key === 'ArrowDown' ? 'next' : 'previous'); } }}><div className="composer-approval-header"><strong id="composer-approval-title">Do you want to allow {action || 'this action'}{boundary}?</strong><p id="composer-approval-summary">{approvalSummary(request)}</p>{request.fallbackReason ? <p className="composer-approval-reason">{request.fallbackReason}</p> : null}</div><div className="composer-approval-options" role="group" aria-label="Approval decision"><Button ref={allowButtonRef} variant="primary" autoFocus disabled={submitting} onClick={() => void decide(true)}>Yes, allow</Button><Button ref={denyButtonRef} variant="secondary" disabled={submitting} onClick={() => void decide(false)}>No, deny</Button></div></section>;
}

function approvalSummary(request: ApprovalRequest): string {
  const summary = request.detail['summary'];
  if (typeof summary === 'string' && summary.trim().length > 0) return summary;
  const path = request.detail['path'];
  if (typeof path === 'string' && path.trim().length > 0) return `Workspace path: ${path}`;
  const command = request.detail['command'];
  if (typeof command === 'string' && command.trim().length > 0) return `Command: ${command}`;
  return 'This action needs your approval before the agent can continue.';
}
