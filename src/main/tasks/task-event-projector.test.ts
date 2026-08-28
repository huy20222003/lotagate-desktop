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
    findBySession: vi.fn(async (sessionId: string) => sessionId === task.sessionId ? task : undefined),
    findByCwd: vi.fn(async () => task),
    require: vi.fn(async () => task),
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
    await projector.apply('C:\\workspace', { version: 2, type: 'event', event: 'turn.started', data: { sessionId: 'session-1', turnId: 'turn-1' } });
    expect(tasks.setStatus).toHaveBeenCalledWith('task-1', 'active');
    expect(tasks.update).toHaveBeenCalledWith('task-1', { turnId: 'turn-1' });
    expect(tasks.appendEvent).toHaveBeenCalledWith('task-1', 'context', 'Desktop turn timing marker.', expect.objectContaining({ turnId: 'turn-1', desktopTurnTiming: expect.objectContaining({ phase: 'started', timestampMs: expect.any(Number) }) }));
  });

  it('clears stale turn state after a failed turn', async () => {
    const { projector, tasks } = createProjector({ ...createTask(), turnId: 'turn-1', status: 'active' });
    await projector.apply('C:\\workspace', { version: 2, type: 'event', event: 'turn.failed', data: { sessionId: 'session-1', turnId: 'turn-1', error: 'Agent failed.' } });
    expect(tasks.setStatus).toHaveBeenCalledWith('task-1', 'failed');
    expect(tasks.update).toHaveBeenCalledWith('task-1', { turnId: undefined, interruptedReason: 'Agent failed.' });
    expect(tasks.appendEvent).toHaveBeenCalledWith('task-1', 'context', 'Desktop turn timing marker.', expect.objectContaining({ turnId: 'turn-1', desktopTurnTiming: expect.objectContaining({ phase: 'failed', timestampMs: expect.any(Number) }) }));
  });

  it('persists the compacted marker emitted by the CLI context manager', async () => {
    const { projector, tasks } = createProjector(createTask());
    await projector.apply('C:\\workspace', { version: 2, type: 'event', event: 'context.compacted', data: { sessionId: 'session-1', turnId: 'turn-1' } });
    expect(tasks.appendEvent).toHaveBeenCalledWith('task-1', 'context', 'Agent context was compacted.', expect.objectContaining({ sessionId: 'session-1', turnId: 'turn-1' }));
  });

  it('does not persist transient tool progress in the conversation transcript', async () => {
    const { projector, tasks } = createProjector(createTask());
    await projector.apply('C:\\workspace', { version: 2, type: 'event', event: 'tool.completed', data: { sessionId: 'session-1', toolName: 'browser.newTab', displayName: 'browser.newTab', isError: true } });
    expect(tasks.appendEvent).not.toHaveBeenCalled();
  });

  it('does not persist command output in the conversation transcript', async () => {
    const { projector, tasks } = createProjector(createTask());
    await projector.apply('C:\\workspace', { version: 2, type: 'event', event: 'turn.started', data: { sessionId: 'session-1', turnId: 'turn-1' } });
    await projector.apply('C:\\workspace', { version: 2, type: 'event', event: 'command.output', data: { content: 'command output' } });
    expect(tasks.appendEvent).not.toHaveBeenCalledWith('task-1', 'command', 'command output', expect.any(Object));
  });

  it('does not fall back to the latest cwd task for an event from an unknown session', async () => {
    const { projector, tasks } = createProjector(createTask());
    await projector.apply('C:\\workspace', { version: 2, type: 'event', event: 'command.output', data: { sessionId: 'unknown-session', content: 'unrelated output' } });
    expect(tasks.appendEvent).not.toHaveBeenCalled();
    expect(tasks.findByCwd).not.toHaveBeenCalled();
  });
});
