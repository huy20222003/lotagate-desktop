import { describe, expect, it } from 'vitest';
import { applyPlanEvent, applySubagentEvent } from './orchestration-events.js';

describe('orchestration event projection', () => {
  it('projects a plan and its current step', () => {
    const started = applyPlanEvent(undefined, 'plan.started', { planId: 'plan-1', goal: 'Refactor', totalSteps: 2, steps: [{ index: 0, id: 'inspect', title: 'Inspect', description: '', status: 'queued' }, { index: 1, id: 'verify', title: 'Verify', description: '', status: 'queued' }] });
    expect(applyPlanEvent(started, 'plan.step.started', { planId: 'plan-1', index: 1 })?.currentStep).toBe(1);
    expect(applyPlanEvent(started, 'plan.completed', { planId: 'plan-1' })?.status).toBe('completed');
  });

  it('retains subagent handoff details across lifecycle updates', () => {
    const created = applySubagentEvent([], 'subagent.created', { id: 'sub-1', displayName: 'Researcher 1', task: 'Inspect', mode: 'research', model: 'model-a', status: 'queued', background: false, timestamp: 1 });
    const completed = applySubagentEvent(created, 'subagent.completed', { id: 'sub-1', status: 'completed', summary: 'Done', handoff: { summary: 'Done', filesInspected: ['README.md'], filesChanged: [], commandsRun: [], verification: [], warnings: [] } });
    expect(completed[0]).toMatchObject({ displayName: 'Researcher 1', status: 'completed', handoff: { filesInspected: ['README.md'] } });
  });
});
