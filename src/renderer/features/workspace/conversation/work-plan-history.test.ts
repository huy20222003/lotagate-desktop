import { describe, expect, it } from 'vitest';
import { DESKTOP_TURN_TIMING_METADATA_KEY, type Activity } from '../../../../contracts/ipc/v1/workspace.js';
import { restoreWorkPlan } from './work-plan-history.js';

function activity(id: string, metadata: Record<string, unknown>): Activity {
  return { id, taskId: 'task-1', kind: 'context', text: id, metadata, createdAt: '2026-09-03T00:00:00.000Z' };
}

function planEvent(turnId: string, planId: string): Activity {
  return activity(`plan-${planId}`, { turnId, planId, version: 1, goal: planId, language: 'en', totalSteps: 1, steps: [{ id: 'step-1', title: planId, status: 'active' }], orchestrationEvent: 'work.plan.created' });
}

describe('work-plan history', () => {
  it('does not restore an unfinished plan after its turn fails', () => {
    const failed = activity('failed', { turnId: 'turn-1', [DESKTOP_TURN_TIMING_METADATA_KEY]: { phase: 'failed', timestampMs: 1 } });

    expect(restoreWorkPlan([planEvent('turn-1', 'old-plan'), failed])).toBeUndefined();
  });

  it('preserves a later turn plan after an earlier turn fails', () => {
    const failed = activity('failed', { turnId: 'turn-1', [DESKTOP_TURN_TIMING_METADATA_KEY]: { phase: 'cancelled', timestampMs: 2 } });

    expect(restoreWorkPlan([planEvent('turn-1', 'old-plan'), failed, planEvent('turn-2', 'new-plan')])?.id).toBe('new-plan');
  });
});
