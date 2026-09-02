import { describe, expect, it } from 'vitest';
import type { Task } from '../../../contracts/ipc/v1/workspace.js';
import { firstTaskForWorkspace, orderTasksForSidebar } from './task-order.js';

function task(id: string, updatedAt: string, pinned = false, archived = false): Task {
  return { id, workspaceId: 'workspace-1', title: id, cwd: 'C:\\workspace', status: 'completed', pinned, archived, draft: '', draftAttachmentIds: [], lastEventCursor: 0, createdAt: updatedAt, updatedAt };
}

describe('task sidebar ordering', () => {
  it('matches the visible sidebar order', () => {
    const tasks = [task('old', '2026-09-01T00:00:00.000Z'), task('pinned', '2026-08-01T00:00:00.000Z', true), task('latest', '2026-09-02T00:00:00.000Z'), task('archived', '2026-09-03T00:00:00.000Z', false, true)];

    expect(orderTasksForSidebar(tasks.filter(item => !item.archived)).map(item => item.id)).toEqual(['pinned', 'latest', 'old']);
    expect(firstTaskForWorkspace(tasks, 'workspace-1')?.id).toBe('pinned');
  });
});
