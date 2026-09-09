import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { CornerDownLeft } from 'lucide-react';
import { Button, Icon, TextInput } from '../ui.js';
import { formatToolDisplayName } from '../../../shared/tool-display.js';
import type { DesktopApprovalDecision } from '../../../contracts/ipc/v1/approval.js';

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

type ApprovalChoice = 'yes' | 'no' | 'other';

export function ApprovalPrompt({ request, onDecision, allowOther = true, manualSubmit = true }: { request: ApprovalDescriptor; onDecision: (decision: DesktopApprovalDecision) => Promise<void>; allowOther?: boolean; manualSubmit?: boolean }) {
  const [submitting, setSubmitting] = useState(false);
  const [choice, setChoice] = useState<ApprovalChoice>('yes');
  const [otherMessage, setOtherMessage] = useState('');
  const promptId = useId();
  const titleId = `approval-title-${promptId}`;
  const summaryId = `approval-summary-${promptId}`;
  const allowButtonRef = useRef<HTMLButtonElement>(null);
  const denyButtonRef = useRef<HTMLButtonElement>(null);
  const otherInputRef = useRef<HTMLInputElement>(null);
  const displayName = formatToolDisplayName(request.toolName, request.displayName);
  const action = displayName.toLowerCase();
  const canSubmit = choice !== 'other' || otherMessage.trim().length > 0;
  const sendDecision = useCallback(async (decision: DesktopApprovalDecision) => {
    if (submitting) return;
    setSubmitting(true);
    try {
      await onDecision(decision);
    } finally {
      setSubmitting(false);
    }
  }, [onDecision, submitting]);
  const submit = useCallback(async () => {
    if (submitting || !canSubmit) {
      if (!canSubmit) otherInputRef.current?.focus();
      return;
    }
    await sendDecision(choice === 'yes' ? { decision: 'allow' } : choice === 'other' ? { decision: 'redirect', message: otherMessage.trim() } : { decision: 'deny' });
  }, [canSubmit, choice, otherMessage, sendDecision, submitting]);
  const selectChoice = (next: ApprovalChoice) => {
    setChoice(next);
    if (next === 'other') window.requestAnimationFrame(() => otherInputRef.current?.focus());
  };
  const moveDecisionFocus = (direction: 'next' | 'previous') => {
    const controls = [allowButtonRef.current, denyButtonRef.current, allowOther ? otherInputRef.current : null].filter((control): control is HTMLButtonElement | HTMLInputElement => control !== null);
    const activeIndex = controls.findIndex(control => control === document.activeElement);
    if (activeIndex === -1 || controls.length === 0) return;
    const offset = direction === 'next' ? 1 : -1;
    controls[(activeIndex + offset + controls.length) % controls.length]?.focus();
  };
  useEffect(() => {
    setChoice('yes');
    setOtherMessage('');
    allowButtonRef.current?.focus();
    const refocusTimer = window.setTimeout(() => allowButtonRef.current?.focus(), 0);
    return () => window.clearTimeout(refocusTimer);
  }, [request.approvalId]);
  const boundary = request.executionBoundary === 'host' ? ' outside the sandbox' : '';
  useEffect(() => {
    const handleGlobalKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Enter' || event.isComposing || event.repeat) return;
      event.preventDefault();
      event.stopPropagation();
      void submit();
    };
    document.addEventListener('keydown', handleGlobalKeyDown, true);
    return () => document.removeEventListener('keydown', handleGlobalKeyDown, true);
  }, [request.approvalId, submit]);
  return <section className="composer-approval" role="alertdialog" aria-labelledby={titleId} aria-describedby={summaryId} aria-busy={submitting} onKeyDown={event => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); moveDecisionFocus(event.key === 'ArrowDown' ? 'next' : 'previous'); } }}><div className="composer-approval-header"><strong id={titleId}>Do you want to allow {action || 'this action'}{boundary}?</strong><p id={summaryId}>{approvalSummary(request, displayName)}</p>{request.fallbackReason ? <p className="composer-approval-reason">{request.fallbackReason}</p> : null}</div><div className="composer-approval-options" role="radiogroup" aria-label="Approval decision"><Button ref={allowButtonRef} type="button" variant={choice === 'yes' ? 'primary' : 'secondary'} aria-pressed={choice === 'yes'} autoFocus disabled={submitting} onClick={() => manualSubmit ? selectChoice('yes') : void sendDecision({ decision: 'allow' })}>{request.allowLabel ?? 'Yes, allow'}</Button><Button ref={denyButtonRef} type="button" variant={choice === 'no' ? 'primary' : 'secondary'} aria-pressed={choice === 'no'} disabled={submitting} onClick={() => manualSubmit ? selectChoice('no') : void sendDecision({ decision: 'deny' })}>No, deny</Button>{allowOther ? <div className={`composer-approval-other ${choice === 'other' ? 'is-selected' : ''}`}><TextInput ref={otherInputRef} aria-label="Other approval instruction" placeholder="Other" value={otherMessage} disabled={submitting} onFocus={() => setChoice('other')} onChange={event => { setOtherMessage(event.target.value); setChoice('other'); }} /></div> : null}</div>{manualSubmit ? <div className="composer-approval-submit"><Button type="button" variant="primary" disabled={submitting || !canSubmit} onClick={() => void submit()}>Submit <Icon icon={CornerDownLeft} size={14} /></Button></div> : null}</section>;
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
