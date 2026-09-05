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
    appendAssistantDeltas: vi.fn(async () => [task]),
    completeAssistantSegment: vi.fn(async () => task),
  } as unknown as TaskStore;
  return { projector: new TaskEventProjector(tasks), tasks };
}

describe('TaskEventProjector turn lifecycle', () => {
  it('persists the turn id as soon as the CLI reports turn.started', async () => {
    const { projector, tasks } = createProjector(createTask());
    await projector.apply('C:\\workspace', { version: 1, type: 'event', scope: 'session', event: 'turn.started', data: { sessionId: 'session-1', turnId: 'turn-1' } });
    expect(tasks.setStatus).toHaveBeenCalledWith('task-1', 'active');
    expect(tasks.update).toHaveBeenCalledWith('task-1', { turnId: 'turn-1' });
    expect(tasks.appendEvent).toHaveBeenCalledWith('task-1', 'context', 'Desktop turn timing marker.', expect.objectContaining({ turnId: 'turn-1', desktopTurnTiming: expect.objectContaining({ phase: 'started', timestampMs: expect.any(Number) }) }));
  });

  it('clears stale turn state after a failed turn', async () => {
    const { projector, tasks } = createProjector({ ...createTask(), turnId: 'turn-1', status: 'active' });
    await projector.apply('C:\\workspace', { version: 1, type: 'event', scope: 'session', event: 'turn.failed', data: { sessionId: 'session-1', turnId: 'turn-1', error: 'Agent failed.' } });
    expect(tasks.setStatus).toHaveBeenCalledWith('task-1', 'failed');
    expect(tasks.update).toHaveBeenCalledWith('task-1', { turnId: undefined, interruptedReason: 'Agent failed.' });
    expect(tasks.appendEvent).toHaveBeenCalledWith('task-1', 'context', 'Desktop turn timing marker.', expect.objectContaining({ turnId: 'turn-1', desktopTurnTiming: expect.objectContaining({ phase: 'failed', timestampMs: expect.any(Number) }) }));
    expect(tasks.appendEvent).toHaveBeenCalledWith('task-1', 'error', 'The response could not be completed: Agent failed.', expect.objectContaining({ turnId: 'turn-1' }));
  });

  it('uses a user-facing message when an approval denial fails the turn', async () => {
    const { projector, tasks } = createProjector(createTask());
    await projector.apply('C:\\workspace', { version: 1, type: 'event', scope: 'session', event: 'turn.failed', data: { sessionId: 'session-1', turnId: 'turn-1', error: { message: 'The tool action was denied by the active workspace policy.' } } });
    expect(tasks.appendEvent).toHaveBeenCalledWith('task-1', 'error', 'The requested action was not completed because approval was declined.', expect.objectContaining({ turnId: 'turn-1' }));
  });

  it('persists the compacted marker emitted by the CLI context manager', async () => {
    const { projector, tasks } = createProjector(createTask());
    await projector.apply('C:\\workspace', { version: 1, type: 'event', scope: 'session', event: 'context.compacted', data: { sessionId: 'session-1', turnId: 'turn-1' } });
    expect(tasks.appendEvent).toHaveBeenCalledWith('task-1', 'context', 'Agent context was compacted.', expect.objectContaining({ sessionId: 'session-1', turnId: 'turn-1' }));
  });

  it('persists tool progress outside the conversation transcript', async () => {
    const { projector, tasks } = createProjector(createTask());
    await projector.apply('C:\\workspace', { version: 1, type: 'event', scope: 'session', event: 'tool.completed', data: { sessionId: 'session-1', toolName: 'browser.newTab', displayName: 'browser.newTab', isError: true } });
    expect(tasks.appendEvent).toHaveBeenCalledWith('task-1', 'tool', 'Open new tab failed.', expect.objectContaining({ sessionId: 'session-1', toolName: 'browser.newTab', isError: true }));
  });

  it('does not duplicate generic lifecycle entries for detailed filesystem activity', async () => {
    const { projector, tasks } = createProjector(createTask());
    await projector.apply('C:\\workspace', { version: 1, type: 'event', scope: 'session', event: 'tool.completed', data: { sessionId: 'session-1', actionId: 'run-1:filesystem.read', toolName: 'filesystem.read', displayName: 'filesystem.read', isError: false } });
    expect(tasks.appendEvent).not.toHaveBeenCalled();
  });

  it('persists shell activity updates with the safe display command', async () => {
    const { projector, tasks } = createProjector(createTask());
    await projector.apply('C:\\workspace', { version: 1, type: 'event', scope: 'session', event: 'tool.activity.started', data: { sessionId: 'session-1', actionId: 'run-1:shell.exec', toolName: 'shell.exec', command: 'Get-Content test.md', status: 'running' } });
    expect(tasks.appendEvent).toHaveBeenCalledWith('task-1', 'tool', 'Running Get-Content test.md.', expect.objectContaining({ command: 'Get-Content test.md', actionId: 'run-1:shell.exec' }));
  });

  it('finalizes a persisted assistant segment without adding transcript text', async () => {
    const { projector, tasks } = createProjector(createTask());
    await projector.apply('C:\\workspace', { version: 1, type: 'event', scope: 'session', event: 'assistant.segment.completed', data: { sessionId: 'session-1', turnId: 'turn-1', segmentId: 'run-1:1', phase: 'final' } });
    expect(tasks.completeAssistantSegment).toHaveBeenCalledWith('task-1', 'run-1:1', 'final');
    expect(tasks.appendEvent).not.toHaveBeenCalledWith('task-1', 'assistant', expect.anything(), expect.anything());
  });

  it('does not persist command output in the conversation transcript', async () => {
    const { projector, tasks } = createProjector(createTask());
    await projector.apply('C:\\workspace', { version: 1, type: 'event', scope: 'session', event: 'turn.started', data: { sessionId: 'session-1', turnId: 'turn-1' } });
    await projector.apply('C:\\workspace', { version: 1, type: 'event', scope: 'control', event: 'command.output', data: { content: 'command output' } });
    expect(tasks.appendEvent).not.toHaveBeenCalledWith('task-1', 'command', 'command output', expect.any(Object));
  });

  it('batches assistant deltas and flushes them before the next lifecycle event', async () => {
    const { projector, tasks } = createProjector(createTask());
    await projector.apply('C:\\workspace', { version: 1, type: 'event', scope: 'session', event: 'assistant.delta', data: { sessionId: 'session-1', turnId: 'turn-1', segmentId: 'run-1:1', content: 'Hello ' } });
    await projector.apply('C:\\workspace', { version: 1, type: 'event', scope: 'session', event: 'assistant.delta', data: { sessionId: 'session-1', turnId: 'turn-1', segmentId: 'run-1:1', content: 'world' } });
    expect(tasks.appendAssistantDeltas).not.toHaveBeenCalled();

    await projector.apply('C:\\workspace', { version: 1, type: 'event', scope: 'session', event: 'assistant.segment.completed', data: { sessionId: 'session-1', turnId: 'turn-1', segmentId: 'run-1:1', phase: 'final' } });
    expect(tasks.appendAssistantDeltas).toHaveBeenCalledTimes(1);
    expect(tasks.appendAssistantDeltas).toHaveBeenCalledWith('task-1', [
      expect.objectContaining({ text: 'Hello ' }),
      expect.objectContaining({ text: 'world' }),
    ]);
  });

  it('does not fall back to the latest cwd task for an event from an unknown session', async () => {
    const { projector, tasks } = createProjector(createTask());
    await projector.apply('C:\\workspace', { version: 1, type: 'event', scope: 'control', event: 'command.output', data: { sessionId: 'unknown-session', content: 'unrelated output' } });
    expect(tasks.appendEvent).not.toHaveBeenCalled();
    expect(tasks.findByCwd).not.toHaveBeenCalled();
  });

  it('uses the explicit task identity before session or cwd fallbacks', async () => {
    const { projector, tasks } = createProjector(createTask());
    await projector.apply('C:\\workspace', { version: 1, type: 'event', scope: 'session', event: 'tool.completed', data: { taskId: 'task-1', sessionId: 'unknown-session', toolName: 'filesystem.list', isError: false } });
    expect(tasks.appendEvent).toHaveBeenCalledWith('task-1', 'tool', 'List files completed.', expect.any(Object));
    expect(tasks.findBySession).not.toHaveBeenCalled();
    expect(tasks.findByCwd).not.toHaveBeenCalled();
  });
});
