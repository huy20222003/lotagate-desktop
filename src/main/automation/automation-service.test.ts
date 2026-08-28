import { describe, expect, it } from 'vitest';
import { AutomationService, type Automation, type AutomationExecutionResult, type AutomationRunStore, type AutomationRunner, type AutomationStore } from './automation-service.js';
import type { AutomationRun } from '../../contracts/ipc/v1/automation.js';

function createStore(): AutomationStore {
  let values: Automation[] = [];
  return {
    read: async () => values,
    update: async mutator => { values = await mutator(values); return values; },
  };
}

function createRunStore(): AutomationRunStore {
  let values: AutomationRun[] = [];
  return {
    read: async () => values,
    update: async mutator => { values = await mutator(values); return values; },
  };
}

describe('AutomationService', () => {
  it('prevents overlapping manual and scheduled runs for one automation', async () => {
    const service = new AutomationService(createStore(), createRunStore());
    const automation = await service.create({ name: 'Test automation', workspaceId: 'workspace-1', prompt: 'Run test', schedule: { kind: 'once', at: new Date(Date.now() + 60_000).toISOString(), timezone: 'UTC' } });
    let calls = 0;
    let release!: () => void;
    const blocked = new Promise<void>(resolve => { release = resolve; });
    const first = service.run(automation.id, async () => { calls += 1; await blocked; });
    await expect(service.run(automation.id, async () => { calls += 1; })).rejects.toThrow('already running');
    release();
    await first;
    expect(calls).toBe(1);
  });

  it('cancels an active run and keeps the cancelled terminal state', async () => {
    const service = new AutomationService(createStore(), createRunStore());
    const automation = await service.create({ name: 'Cancelable automation', workspaceId: 'workspace-1', prompt: 'Wait', schedule: { kind: 'manual' } });
    let release!: () => void;
    const waiting = new Promise<void>(resolve => { release = resolve; });
    const runPromise = service.runNow(automation.id, async (_item, _run, signal): Promise<AutomationExecutionResult> => {
      await new Promise<void>(resolve => signal.addEventListener('abort', () => { release(); resolve(); }, { once: true }));
      await waiting;
      return { summary: 'Should not succeed' };
    });
    let run = (await service.runs(automation.id))[0];
    for (let attempt = 0; run?.status !== 'running' && attempt < 20; attempt += 1) { await new Promise(resolve => setTimeout(resolve, 0)); run = (await service.runs(automation.id))[0]; }
    if (!run) throw new Error('Run was not created.');
    await service.cancel(run.id);
    const result = await runPromise;
    expect(result.status).toBe('cancelled');
  });

  it('supports a manual retry after a failed run', async () => {
    const service = new AutomationService(createStore(), createRunStore());
    const automation = await service.create({ name: 'Retry automation', workspaceId: 'workspace-1', prompt: 'Retry', schedule: { kind: 'manual' } });
    let attempts = 0;
    const runner: AutomationRunner = async () => { attempts += 1; if (attempts === 1) throw new Error('temporary failure'); return { summary: 'Recovered' }; };
    const failed = await service.runNow(automation.id, runner);
    expect(failed.status).toBe('failed');
    const retried = await service.retry(failed.id, runner);
    expect(retried.status).toBe('succeeded');
    expect(attempts).toBe(2);
  });

  it('waits for due runs when invoked by a headless scheduler', async () => {
    const store = createStore();
    const service = new AutomationService(store, createRunStore());
    const automation = await service.create({ name: 'Headless automation', workspaceId: 'workspace-1', prompt: 'Run headless', schedule: { kind: 'interval', everyMinutes: 1, timezone: 'UTC' } });
    await store.update(current => current.map(item => item.id === automation.id ? { ...item, nextRunAt: new Date(Date.now() - 1_000).toISOString() } : item));
    let completed = false;
    await service.runDueNow(async () => { await new Promise(resolve => setTimeout(resolve, 5)); completed = true; return { summary: 'Completed in the scheduler process.' }; });
    expect(completed).toBe(true);
    expect((await service.runs(automation.id))[0]?.status).toBe('succeeded');
  });

  it('moves review-gated runs through an explicit approve decision', async () => {
    const service = new AutomationService(createStore(), createRunStore());
    const automation = await service.create({ name: 'Review automation', workspaceId: 'workspace-1', prompt: 'Review', schedule: { kind: 'manual' }, permissionPolicy: 'review' });
    const pending = await service.runNow(automation.id, async () => ({ reviewRequired: true, summary: 'Ready for review' }));
    expect(pending.status).toBe('awaiting_review');
    expect((await service.review(pending.id, true)).reviewStatus).toBe('approved');
  });

  it('recovers persisted queued and running runs after a Desktop restart', async () => {
    const store = createStore();
    const runs = createRunStore();
    const service = new AutomationService(store, runs);
    const automation = await service.create({ name: 'Recovery automation', workspaceId: 'workspace-1', prompt: 'Recover', schedule: { kind: 'manual' } });
    await runs.update(current => [...current, { id: 'stale-run', automationId: automation.id, status: 'running', attempt: 1, changedFiles: [], artifactIds: [], reviewStatus: 'not_required', createdAt: new Date().toISOString() }]);
    service.start(async () => ({}), 60 * 60 * 1_000);
    for (let attempt = 0; attempt < 20; attempt += 1) {
      if ((await service.runs(automation.id))[0]?.status === 'failed') break;
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    expect((await service.runs(automation.id))[0]).toEqual(expect.objectContaining({ id: 'stale-run', status: 'failed', error: 'Desktop restarted before this automation run completed.' }));
    service.stop();
  });

  it('pauses an automation at an approval request and resumes after the Desktop decision', async () => {
    const service = new AutomationService(createStore(), createRunStore());
    const automation = await service.create({ name: 'Approval automation', workspaceId: 'workspace-1', prompt: 'Approve', schedule: { kind: 'manual' }, permissionPolicy: 'review' });
    let approvalId = '';
    let responderDecision: boolean | undefined;
    const running = service.runNow(automation.id, async (_item, run) => {
      approvalId = 'approval-1';
      const approved = await service.requestApproval(run.id, { approvalId, toolName: 'shell.exec', displayName: 'Run command', kind: 'command', detail: { summary: 'Run a test command.' } }, async decision => { responderDecision = decision; });
      return { summary: approved ? 'Approved' : 'Denied', reviewRequired: true };
    });
    let pending = (await service.runs(automation.id))[0];
    for (let attempt = 0; attempt < 20 && pending?.status !== 'awaiting_approval'; attempt += 1) { await new Promise(resolve => setTimeout(resolve, 0)); pending = (await service.runs(automation.id))[0]; }
    if (!pending || pending.pendingApproval === undefined) throw new Error('Approval was not persisted.');
    expect(pending.status).toBe('awaiting_approval');
    await service.respondApproval(pending.id, pending.pendingApproval.approvalId, true);
    expect((await running).status).toBe('awaiting_review');
    expect(responderDecision).toBe(true);
  });
});
