import type { DesktopApprovalRequest } from '../../../contracts/ipc/v1/approval.js';
import { ApprovalPrompt } from './ApprovalPrompt.js';

export function InlineApproval({ request, onDecision }: { request: DesktopApprovalRequest; onDecision: (approved: boolean) => Promise<void> }) {
  const descriptor = { approvalId: request.approvalId, toolName: request.toolName, ...(request.displayName === undefined ? {} : { displayName: request.displayName }), ...(request.kind === undefined ? {} : { kind: request.kind }), detail: request.detail, ...(request.executionBoundary === undefined ? {} : { executionBoundary: request.executionBoundary }), ...(request.fallbackReason === undefined ? {} : { fallbackReason: request.fallbackReason }) };
  return <ApprovalPrompt request={descriptor} allowOther={false} manualSubmit={false} onDecision={decision => onDecision(decision.decision === 'allow')} />;
}
