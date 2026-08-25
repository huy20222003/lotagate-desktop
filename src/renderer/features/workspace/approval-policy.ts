import type { ApprovalRequest } from '../../../contracts/ipc/v1/workspace.js';
import { isReadOnlyCommand } from '../../../contracts/command-policy.js';

export type ApprovalMode = 'auto' | 'ask';

export function shouldAutoApprove(request: ApprovalRequest, mode: ApprovalMode): boolean {
  return mode === 'auto' || isReadOnlyApproval(request);
}

function isReadOnlyApproval(request: ApprovalRequest): boolean {
  const detail = Object.values(request.detail).filter((value): value is string => typeof value === 'string').join(' ');
  return isReadOnlyCommand(`${request.toolName} ${request.displayName} ${request.kind} ${detail}`);
}
