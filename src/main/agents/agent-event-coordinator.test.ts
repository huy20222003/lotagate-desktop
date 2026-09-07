import { describe, expect, it, vi } from 'vitest';
import type { DesktopEvent } from '../../contracts/agent-protocol/v1/desktop.js';
import type { CheckpointService } from '../checkpoints/checkpoint-service.js';
import type { RemoteControlService } from '../remote-control/remote-control-service.js';
import type { TaskEventProjector } from '../tasks/task-event-projector.js';
import type { TaskTurnCoordinator } from '../tasks/task-turn-coordinator.js';
import { AgentEventCoordinator } from './agent-event-coordinator.js';

const event: DesktopEvent = {
  version: 1,
  type: 'event',
  scope: 'session',
  event: 'turn.completed',
  data: { taskId: 'task-1', sessionId: 'session-1', turnId: 'turn-1', success: true },
};

function createCoordinator(overrides: Partial<ConstructorParameters<typeof AgentEventCoordinator>[0]> = {}) {
  const taskTurns = { observe: vi.fn() } as unknown as TaskTurnCoordinator;
  const checkpoints = { observeEvent: vi.fn() } as unknown as CheckpointService;
  const taskProjector = { apply: vi.fn().mockResolvedValue(undefined) } as unknown as TaskEventProjector;
  const remoteControl = { publishAgentEvent: vi.fn(), observeAgentEvent: vi.fn() } as unknown as RemoteControlService;
  const options: ConstructorParameters<typeof AgentEventCoordinator>[0] = {
    taskTurns,
    checkpoints,
    taskProjector,
    getTitleGenerationService: () => undefined,
    getRemoteControlService: () => remoteControl,
    logEvent: vi.fn(),
    onPersistenceError: vi.fn(),
    onTaskUpdated: vi.fn(),
    onAgentEvent: vi.fn(),
    ...overrides,
  };
  return { coordinator: new AgentEventCoordinator(options), taskTurns, checkpoints, taskProjector, remoteControl, options };
}

describe('AgentEventCoordinator', () => {
  it('routes persistence and remote publication through one event path', async () => {
    const { coordinator, taskTurns, checkpoints, taskProjector, remoteControl, options } = createCoordinator();

    coordinator.observe('D:/workspace', event, false);

    expect(taskTurns.observe).toHaveBeenCalledWith('task-1', event);
    expect(checkpoints.observeEvent).toHaveBeenCalledWith('D:/workspace', event);
    expect(options.onAgentEvent).toHaveBeenCalledWith('D:/workspace', event);
    expect(taskProjector.apply).toHaveBeenCalledWith('D:/workspace', event);
    await vi.waitFor(() => expect(remoteControl.publishAgentEvent).toHaveBeenCalledWith('D:/workspace', event));
    expect(remoteControl.observeAgentEvent).toHaveBeenCalledWith(event);
  });

  it('does not fan automation or approval events into the renderer', () => {
    const { coordinator, options } = createCoordinator();

    coordinator.observe('D:/workspace', event, true);
    coordinator.observe('D:/workspace', { ...event, event: 'approval.requested' }, false);

    expect(options.onAgentEvent).not.toHaveBeenCalled();
  });
});
