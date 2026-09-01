import { describe, expect, it } from 'vitest';
import type { Automation, AutomationRun, AutomationStateEvent } from '../../contracts/ipc/v1/automation.js';
import { automationNotification } from './automation-notification.js';

const automation: Automation = {
  id: 'automation-1', name: 'Quick automation test', description: 'Test', prompt: 'Inspect the workspace.', workspaceId: 'workspace-1', worktree: false,
  skills: [], tools: [], permissionPolicy: 'ask', browserAccess: 'disabled', schedule: { kind: 'manual' }, retryPolicy: { maxAttempts: 0, backoffMs: 1_000 }, timeoutMs: 60_000,
  notifications: true, keepSession: true, enabled: true, nextRunAt: null, lastRunAt: null, lastError: null, createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z',
};

function run(overrides: Partial<AutomationRun> = {}): AutomationRun {
  return { id: 'run-1', automationId: automation.id, status: 'succeeded', attempt: 1, changedFiles: [], artifactIds: [], reviewStatus: 'not_required', createdAt: '2026-09-01T00:00:00.000Z', ...overrides };
}

function event(type: AutomationStateEvent['type'], currentRun: AutomationRun): AutomationStateEvent {
  return { type, automationId: automation.id, automation, run: currentRun };
}

describe('automationNotification', () => {
  it('formats a successful result with a professional completion message', () => {
    const notification = automationNotification(event('completed', run({ summary: 'All workspace checks passed.' })));
    expect(notification).toEqual({ title: 'Automation · Quick automation test', body: 'Completed successfully. Result: All workspace checks passed.' });
  });

  it('describes approval requests without exposing approval detail payloads', () => {
    const notification = automationNotification(event('approval_requested', run({ status: 'awaiting_approval', pendingApproval: { approvalId: 'approval-1', toolName: 'terminal.execute', displayName: 'Run command', kind: 'terminal', detail: { command: 'secret command' }, requestedAt: '2026-09-01T00:00:00.000Z' } })));
    expect(notification?.body).toBe('Approval required to Run command.');
    expect(notification?.body).not.toContain('secret command');
  });

  it('reports failed and review-pending runs', () => {
    expect(automationNotification(event('failed', run({ status: 'failed', error: 'The command failed.' })))?.body).toBe('Run failed. The command failed.');
    expect(automationNotification(event('completed', run({ status: 'awaiting_review' })))?.body).toBe('Completed and waiting for review.');
  });

  it('does not notify for state changes without a user-facing outcome', () => {
    expect(automationNotification(event('started', run({ status: 'running' })))).toBeUndefined();
  });
});
