import { describe, expect, it, vi } from 'vitest';
import { loadWorkspaceTasks } from './ProfilePanel.js';

describe('loadWorkspaceTasks', () => {
  it('limits concurrent workspace task requests while preserving workspace order', async () => {
    let active = 0;
    let maximumActive = 0;
    const resolvers: Array<() => void> = [];
    const listTasks = vi.fn((workspaceId: string) => new Promise<readonly string[]>(resolve => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      resolvers.push(() => { active -= 1; resolve([workspaceId]); });
    }));
    const pending = loadWorkspaceTasks(['a', 'b', 'c', 'd', 'e'], listTasks);

    expect(listTasks).toHaveBeenCalledTimes(4);
    for (let index = 0; index < 5; index += 1) {
      while (resolvers.length === 0) await new Promise(resolve => setTimeout(resolve, 0));
      resolvers.shift()?.();
    }

    await expect(pending).resolves.toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(maximumActive).toBe(4);
  });
});
