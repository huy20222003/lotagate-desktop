import { describe, expect, it } from 'vitest';
import { AutomationService, type Automation, type AutomationStore } from './automation-service.js';

function createStore(): AutomationStore {
  let values: Automation[] = [];
  return {
    read: async () => values,
    update: async mutator => { values = await mutator(values); return values; },
  };
}

describe('AutomationService', () => {
  it('prevents overlapping manual and scheduled runs for one automation', async () => {
    const service = new AutomationService(createStore());
    const automation = await service.create({ name: 'Test automation', workspaceId: 'workspace-1', prompt: 'Run test', schedule: new Date(Date.now() + 60_000).toISOString(), executionPolicy: 'ask' });
    let calls = 0;
    let release!: () => void;
    const blocked = new Promise<void>(resolve => { release = resolve; });
    const first = service.run(automation.id, async () => { calls += 1; await blocked; });
    await expect(service.run(automation.id, async () => { calls += 1; })).rejects.toThrow('already running');
    release();
    await first;
    expect(calls).toBe(1);
  });
});
