import { describe, expect, it } from 'vitest';
import type { Activity } from '../../../contracts/ipc/v1/workspace.js';
import { mergeActivities } from './workspace-controller-helpers.js';

const activity = (id: string, text: string, turnId = 'turn-1'): Activity => ({ id, taskId: 'task-1', kind: 'assistant', text, metadata: { turnId }, createdAt: '2026-08-29T00:00:00.000Z' });

describe('workspace controller activity merging', () => {
  it('removes a temporary stream when its persisted assistant activity arrives', () => {
    const streaming = activity('streaming:task-1:turn-1', 'The response');
    const persisted = activity('assistant-1', 'The response');

    expect(mergeActivities([streaming], [persisted])).toEqual([persisted]);
  });
});
