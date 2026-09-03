// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import type { Task, Workspace } from '../../../../contracts/ipc/v1/workspace.js';
import { cancelWorkspaceTask } from './cancel-workspace-task.js';

const task = { id: 'task-1', workspaceId: 'workspace-1', cwd: 'C:\\workspace', title: 'Task', status: 'active', pinned: false, archived: false, draft: '', draftAttachmentIds: [], lastEventCursor: 0, createdAt: '2026-09-03T00:00:00.000Z', updatedAt: '2026-09-03T00:00:00.000Z', turnId: 'turn-1' } as unknown as Task;
const workspace = { id: 'workspace-1', name: 'Workspace', rootPath: 'C:\\workspace', trusted: true } as unknown as Workspace;

describe('cancelWorkspaceTask', () => {
  it('clears sidebar state immediately after a successful turn cancellation', async () => {
    const cancelled = { ...task, status: 'cancelled', turnId: undefined } as Task;
    const turnCancel = vi.fn().mockResolvedValue({ cancelled: true });
    const taskCancel = vi.fn().mockResolvedValue(cancelled);
    window.lotagate = { agent: { turnCancel }, tasks: { cancel: taskCancel, list: vi.fn() } } as never;
    const markTurnFinished = vi.fn();

    await cancelWorkspaceTask({
      task,
      workspace,
      activeTurn: { taskId: task.id, cwd: task.cwd, turnId: 'turn-1' },
      clearActiveTurn: vi.fn(),
      resetLiveState: vi.fn(),
      markTurnFinished,
      setTask: vi.fn(),
      updateTasks: vi.fn(),
      reloadTasks: vi.fn().mockResolvedValue(undefined),
      setError: vi.fn(),
    });

    expect(turnCancel).toHaveBeenCalledWith(workspace.rootPath, 'turn-1');
    expect(markTurnFinished).toHaveBeenCalledWith(task.id, false);
  });
});
