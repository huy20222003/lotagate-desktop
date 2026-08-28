import type { ApprovalMode } from '../../../contracts/ipc/v1/settings.js';
import type { DesktopApprovalRequest } from '../../../contracts/ipc/v1/approval.js';
import { isReadOnlyCommand } from '../../../contracts/command-policy.js';

export type { ApprovalMode } from '../../../contracts/ipc/v1/settings.js';

export function shouldAutoApproveDesktop(request: Pick<DesktopApprovalRequest, 'detail' | 'displayName' | 'fallbackReason' | 'kind' | 'risk' | 'toolName'>, mode: ApprovalMode): boolean {
  if (request.fallbackReason !== undefined || request.risk === 'elevated') return false;
  if (mode === 'auto') return true;
  return isReadOnlyApproval(request);
}

function isReadOnlyApproval(request: Pick<DesktopApprovalRequest, 'detail' | 'displayName' | 'kind' | 'toolName'>): boolean {
  const detail = Object.values(request.detail).filter((value): value is string => typeof value === 'string').join(' ');
  return isReadOnlyCommand(`${request.toolName} ${request.displayName} ${request.kind} ${detail}`);
}
