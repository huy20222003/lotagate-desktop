import { describe, expect, it } from 'vitest';
import { applyWorkPlanEvent, applySubagentEvent } from './orchestration-events.js';

describe('orchestration event projection', () => {
  it('projects a structured work plan by turn and ignores stale versions', () => {
    const created = applyWorkPlanEvent(undefined, 'work.plan.created', { turnId: 'turn-1', planId: 'plan-1', version: 1, goal: 'Refactor', language: 'en', totalSteps: 2, steps: [{ index: 0, id: 'inspect', title: 'Inspect', description: '', status: 'queued' }, { index: 1, id: 'verify', title: 'Verify', description: '', status: 'queued' }] });
    const started = applyWorkPlanEvent(created, 'work.task.started', { turnId: 'turn-1', planId: 'plan-1', version: 2, stepId: 'verify' });
    expect(started?.currentStep).toBe(1);
    expect(applyWorkPlanEvent(started, 'work.task.completed', { turnId: 'turn-1', planId: 'plan-1', version: 1, stepId: 'verify' })?.steps[1]?.status).toBe('active');
    expect(applyWorkPlanEvent(started, 'work.plan.completed', { turnId: 'turn-1', planId: 'plan-1', version: 3 })?.status).toBe('completed');
  });

  it('replaces the visible plan when a newer turn starts and ignores late events from the old turn', () => {
    const first = applyWorkPlanEvent(undefined, 'work.plan.created', { turnId: 'turn-1', planId: 'plan-1', version: 1, goal: 'First', language: 'en', totalSteps: 1, steps: [{ id: 'inspect', title: 'Inspect', description: '', status: 'queued' }] });
    const second = applyWorkPlanEvent(first, 'work.plan.created', { turnId: 'turn-2', planId: 'plan-2', version: 1, goal: 'Second', language: 'vi', totalSteps: 1, steps: [{ id: 'change', title: 'Change', description: '', status: 'queued' }] });
    expect(second).toMatchObject({ turnId: 'turn-2', id: 'plan-2', goal: 'Second' });
    expect(applyWorkPlanEvent(second, 'work.task.started', { turnId: 'turn-1', planId: 'plan-1', version: 2, stepId: 'inspect' })).toBe(second);
  });

  it('retains subagent handoff details across lifecycle updates', () => {
    const created = applySubagentEvent([], 'subagent.created', { id: 'sub-1', displayName: 'Researcher 1', task: 'Inspect', mode: 'research', model: 'model-a', status: 'queued', background: false, timestamp: 1 });
    const completed = applySubagentEvent(created, 'subagent.completed', { id: 'sub-1', status: 'completed', summary: 'Done', handoff: { summary: 'Done', filesInspected: ['README.md'], filesChanged: [], commandsRun: [], verification: [], warnings: [] } });
    expect(completed[0]).toMatchObject({ displayName: 'Researcher 1', status: 'completed', handoff: { filesInspected: ['README.md'] } });
  });
});
