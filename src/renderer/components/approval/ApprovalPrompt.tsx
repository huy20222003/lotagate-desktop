import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Button } from '../ui.js';
import { formatToolDisplayName } from '../../../shared/tool-display.js';

export interface ApprovalDescriptor {
  approvalId?: string;
  toolName: string;
  displayName?: string;
  kind?: string;
  detail?: Record<string, unknown>;
  executionBoundary?: 'sandbox' | 'host';
  fallbackReason?: string;
  allowLabel?: string;
}

export function ApprovalPrompt({ request, onDecision }: { request: ApprovalDescriptor; onDecision: (approved: boolean) => Promise<void> }) {
  const [submitting, setSubmitting] = useState(false);
  const promptId = useId();
  const titleId = `approval-title-${promptId}`;
  const summaryId = `approval-summary-${promptId}`;
  const allowButtonRef = useRef<HTMLButtonElement>(null);
  const denyButtonRef = useRef<HTMLButtonElement>(null);
  const displayName = formatToolDisplayName(request.toolName, request.displayName);
  const action = displayName.toLowerCase();
  const decide = useCallback(async (approved: boolean) => { if (submitting) return; setSubmitting(true); try { await onDecision(approved); } finally { setSubmitting(false); } }, [onDecision, submitting]);
  const moveDecisionFocus = (direction: 'next' | 'previous') => { const active = document.activeElement; const next = direction === 'next' ? active === allowButtonRef.current ? denyButtonRef.current : allowButtonRef.current : active === denyButtonRef.current ? allowButtonRef.current : denyButtonRef.current; next?.focus(); };
  const boundary = request.executionBoundary === 'host' ? ' outside the sandbox' : '';
  useEffect(() => {
    allowButtonRef.current?.focus();
    const refocusTimer = window.setTimeout(() => allowButtonRef.current?.focus(), 0);
    return () => window.clearTimeout(refocusTimer);
  }, [request.approvalId]);
  useEffect(() => {
    const handleGlobalKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Enter' || event.isComposing || event.repeat) return;
      if (document.activeElement === allowButtonRef.current || document.activeElement === denyButtonRef.current) return;
      event.preventDefault();
      event.stopPropagation();
      void decide(true);
    };
    document.addEventListener('keydown', handleGlobalKeyDown, true);
    return () => document.removeEventListener('keydown', handleGlobalKeyDown, true);
  }, [decide, request.approvalId]);
  return <section className="composer-approval" role="alertdialog" aria-labelledby={titleId} aria-describedby={summaryId} aria-busy={submitting} onKeyDown={event => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); moveDecisionFocus(event.key === 'ArrowDown' ? 'next' : 'previous'); return; } if (event.key === 'Enter' && document.activeElement === allowButtonRef.current) { event.preventDefault(); void decide(true); } }}><div className="composer-approval-header"><strong id={titleId}>Do you want to allow {action || 'this action'}{boundary}?</strong><p id={summaryId}>{approvalSummary(request, displayName)}</p>{request.fallbackReason ? <p className="composer-approval-reason">{request.fallbackReason}</p> : null}</div><div className="composer-approval-options" role="group" aria-label="Approval decision"><Button ref={allowButtonRef} variant="primary" autoFocus disabled={submitting} onClick={() => void decide(true)}>{request.allowLabel ?? 'Yes, allow'}</Button><Button ref={denyButtonRef} variant="secondary" disabled={submitting} onClick={() => void decide(false)}>No, deny</Button></div></section>;
}

function approvalSummary(request: ApprovalDescriptor, displayName: string): string {
  const detail = request.detail ?? {};
  const summary = detail['summary'];
  if (typeof summary === 'string' && summary.trim().length > 0) {
    const rawGeneric = `This ${request.toolName} operation may change workspace or external state.`;
    const formattedGeneric = `This ${displayName} operation may change workspace or external state.`;
    if (summary === rawGeneric || summary === formattedGeneric) return formattedGeneric;
    return summary;
  }
  const path = detail['path'];
  if (typeof path === 'string' && path.trim().length > 0) return `Workspace path: ${path}`;
  const command = detail['command'];
  if (typeof command === 'string' && command.trim().length > 0) return `Command: ${command}`;
  return 'This action needs your approval before it can continue.';
}
