import type { ApprovalMode } from '../../../../contracts/ipc/v1/settings.js';
import type { DesktopApprovalRequest } from '../../../../contracts/ipc/v1/approval.js';
import { isReadOnlyApproval as isReadOnlyApprovalRequest } from '../../../../contracts/command-policy.js';

export type { ApprovalMode } from '../../../../contracts/ipc/v1/settings.js';

export function shouldAutoApproveDesktop(request: Pick<DesktopApprovalRequest, 'detail' | 'displayName' | 'fallbackReason' | 'kind' | 'risk' | 'toolName'>, mode: ApprovalMode): boolean {
  if (mode === 'auto') return true;
  if (request.fallbackReason !== undefined || request.risk === 'elevated') return false;
  return isReadOnlyApproval(request);
}

function isReadOnlyApproval(request: Pick<DesktopApprovalRequest, 'detail' | 'displayName' | 'kind' | 'toolName'>): boolean {
  return isReadOnlyApprovalRequest(request.toolName, request.detail);
}
