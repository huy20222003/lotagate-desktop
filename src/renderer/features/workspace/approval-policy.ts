import type { ApprovalRequest } from '../../../contracts/ipc/v1/workspace.js';

export type ApprovalMode = 'auto' | 'ask';

export function shouldAutoApprove(request: ApprovalRequest, mode: ApprovalMode): boolean {
  return mode === 'auto' || isReadOnlyApproval(request);
}

function isReadOnlyApproval(request: ApprovalRequest): boolean {
  const detail = Object.values(request.detail).filter((value): value is string => typeof value === 'string').join(' ');
  const target = `${request.toolName} ${request.displayName} ${request.kind} ${detail}`.toLowerCase();
  return /\bread[_ -]?file\b|\bread file\b|\bget-content\b|\bcat\b|\btype\b|\bhead\b|\btail\b|\bsed\b|\bgrep\b|\brg\b|\bls\b|\bdir\b|\bpwd\b|\bgit\s+(status|diff|log|show)\b/iu.test(target);
}
