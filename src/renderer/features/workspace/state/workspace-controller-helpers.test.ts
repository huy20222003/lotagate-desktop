import { describe, expect, it, vi } from 'vitest';
import type { Activity } from '../../../../contracts/ipc/v1/workspace.js';
import { discardQueuedAttachments, mergeActivities } from './workspace-controller-helpers.js';
import type { QueuedMessage } from './message-queue-service.js';

const activity = (id: string, text: string, turnId = 'turn-1'): Activity => ({ id, taskId: 'task-1', kind: 'assistant', text, metadata: { turnId }, createdAt: '2026-08-29T00:00:00.000Z' });

describe('workspace controller activity merging', () => {
  it('removes a temporary stream when its persisted assistant activity arrives', () => {
    const streaming = activity('streaming:task-1:turn-1', 'The response');
    const persisted = activity('assistant-1', 'The response');

    expect(mergeActivities([streaming], [persisted])).toEqual([persisted]);
  });

  it('removes the live placeholder when persistence uses its own streaming id', () => {
    const streaming = activity('streaming:task-1:turn-1', 'The response');
    const persisted = activity('streaming:persisted-id', 'The response');

    expect(mergeActivities([streaming], [persisted])).toEqual([persisted]);
  });

  it('removes the live error activity when the persisted error arrives', () => {
    const liveError: Activity = { id: 'error:task-1:turn-1', taskId: 'task-1', kind: 'error', text: 'Failed', metadata: { turnId: 'turn-1' }, createdAt: '2026-08-29T00:00:01.000Z' };
    const persistedError: Activity = { id: 'persisted-error-1', taskId: 'task-1', kind: 'error', text: 'Failed', metadata: { turnId: 'turn-1' }, createdAt: '2026-08-29T00:00:01.000Z' };

    expect(mergeActivities([liveError], [persistedError])).toEqual([persistedError]);
  });
});

describe('workspace controller queued attachment cleanup', () => {
  it('protects attachments referenced by persisted queued prompts during task switching', async () => {
    const deleteArtifact = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('window', { lotagate: { tasks: { queuedPrompts: vi.fn().mockResolvedValue([{ attachmentIds: ['persisted-attachment'] }]), deleteArtifact } } });
    const messages = [{ id: 'queued-1', taskId: 'task-1', prompt: 'queued', attachments: [{ id: 'persisted-attachment' }, { id: 'orphan-attachment' }], createdAt: Date.now() }] as unknown as QueuedMessage[];

    try {
      await discardQueuedAttachments('task-1', messages, [], []);

      expect(deleteArtifact).toHaveBeenCalledOnce();
      expect(deleteArtifact).toHaveBeenCalledWith('task-1', 'orphan-attachment', true);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
