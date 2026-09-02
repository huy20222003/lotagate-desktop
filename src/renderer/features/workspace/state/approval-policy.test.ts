import { describe, expect, it } from 'vitest';
import { shouldAutoApproveDesktop } from './approval-policy.js';
import type { DesktopApprovalRequest } from '../../../../contracts/ipc/v1/approval.js';

const request = (overrides: Partial<DesktopApprovalRequest> = {}): DesktopApprovalRequest => ({
  approvalId: 'approval-1', source: 'agent', surface: 'composer', requestedAt: new Date().toISOString(), taskId: 'task-1', turnId: 'turn-1', toolName: 'shell.exec', displayName: 'Run command', kind: 'command', detail: { command: 'Get-Content', args: ['README.md'] }, risk: 'normal', ...overrides,
});

describe('approval policy', () => {
  it('automatically approves requested actions in approve-for-me mode', () => {
    expect(shouldAutoApproveDesktop(request({ detail: { command: 'Remove-Item output.txt' } }), 'auto')).toBe(true);
  });

  it('automatically approves a sandbox fallback in approve-for-me mode', () => {
    expect(shouldAutoApproveDesktop(request({ risk: 'elevated', executionBoundary: 'sandbox', fallbackReason: 'The sandbox is unavailable.' }), 'auto')).toBe(true);
  });

  it('allows read-only commands without prompting in ask mode', () => {
    expect(shouldAutoApproveDesktop(request(), 'ask')).toBe(true);
  });

  it('keeps mutating commands in the inline approval flow in ask mode', () => {
    expect(shouldAutoApproveDesktop(request({ detail: { command: 'Set-Content README.md' } }), 'ask')).toBe(false);
  });

  it('does not infer shell safety from formatted display text', () => {
    expect(shouldAutoApproveDesktop(request({ toolName: 'shell.exec', detail: { command: 'powershell.exe', args: ['-Command', 'Get-Content README.md; Remove-Item output.txt'], summary: 'Read command' } }), 'ask')).toBe(false);
    expect(shouldAutoApproveDesktop(request({ toolName: 'shell.exec', detail: { summary: 'Run cat helper; remove output.txt' } }), 'ask')).toBe(false);
  });
});
