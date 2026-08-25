import { describe, expect, it, vi } from 'vitest';
import type { Task } from '../../contracts/ipc/v1/workspace.js';
import type { TaskStore } from './task-store.js';
import { TaskEventProjector } from './task-event-projector.js';

function createTask(): Task {
  const timestamp = new Date().toISOString();
  return {
    id: 'task-1', workspaceId: 'workspace-1', title: 'Edit file', cwd: 'C:\\workspace', status: 'queued', sessionId: 'session-1',
    turnId: undefined, model: 'model-1', lastEventCursor: 0, pinned: false, archived: false, draft: '', draftAttachmentIds: [], createdAt: timestamp, updatedAt: timestamp,
  };
}

function createProjector(task: Task) {
  const tasks = {
    findBySession: vi.fn(async () => task),
    findByCwd: vi.fn(async () => undefined),
    setStatus: vi.fn(async (_taskId: string, status: Task['status']) => ({ ...task, status })),
    update: vi.fn(async (_taskId: string, patch: Partial<Task>) => ({ ...task, ...patch })),
    appendEvent: vi.fn(async () => task),
    appendAssistantDelta: vi.fn(async () => task),
  } as unknown as TaskStore;
  return { projector: new TaskEventProjector(tasks), tasks };
}

describe('TaskEventProjector turn lifecycle', () => {
  it('persists the turn id as soon as the CLI reports turn.started', async () => {
    const { projector, tasks } = createProjector(createTask());
    await projector.apply('C:\\workspace', { version: 1, type: 'event', event: 'turn.started', data: { sessionId: 'session-1', turnId: 'turn-1' } });
    expect(tasks.setStatus).toHaveBeenCalledWith('task-1', 'active');
    expect(tasks.update).toHaveBeenCalledWith('task-1', { turnId: 'turn-1' });
  });

  it('clears stale turn state after a failed turn', async () => {
    const { projector, tasks } = createProjector({ ...createTask(), turnId: 'turn-1', status: 'active' });
    await projector.apply('C:\\workspace', { version: 1, type: 'event', event: 'turn.failed', data: { sessionId: 'session-1', turnId: 'turn-1', error: 'Agent failed.' } });
    expect(tasks.setStatus).toHaveBeenCalledWith('task-1', 'failed');
    expect(tasks.update).toHaveBeenCalledWith('task-1', { turnId: undefined, interruptedReason: 'Agent failed.' });
  });
});
