import { describe, expect, it } from 'vitest';
import { shouldAutoApprove } from './approval-policy.js';
import type { ApprovalRequest } from '../../../contracts/ipc/v1/workspace.js';

const request = (overrides: Partial<ApprovalRequest> = {}): ApprovalRequest => ({
  approvalId: 'approval-1', taskId: 'task-1', turnId: 'turn-1', toolName: 'command', displayName: 'Run command', kind: 'command', detail: { command: 'Get-Content README.md' }, ...overrides,
});

describe('approval policy', () => {
  it('automatically approves requested actions in approve-for-me mode', () => {
    expect(shouldAutoApprove(request({ detail: { command: 'Remove-Item output.txt' } }), 'auto')).toBe(true);
  });

  it('allows read-only commands without prompting in ask mode', () => {
    expect(shouldAutoApprove(request(), 'ask')).toBe(true);
  });

  it('keeps mutating commands in the inline approval flow in ask mode', () => {
    expect(shouldAutoApprove(request({ detail: { command: 'Set-Content README.md' } }), 'ask')).toBe(false);
  });
});
