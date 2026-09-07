import type { DesktopEvent } from '../../contracts/agent-protocol/v1/desktop.js';
import type { RemoteControlService } from '../remote-control/remote-control-service.js';
import type { CheckpointService } from '../checkpoints/checkpoint-service.js';
import type { TaskTurnCoordinator } from '../tasks/task-turn-coordinator.js';
import type { TaskEventProjector } from '../tasks/task-event-projector.js';
import type { TaskTitleGenerationService } from '../tasks/task-title-generation-service.js';

export interface AgentEventCoordinatorOptions {
  taskTurns: TaskTurnCoordinator;
  checkpoints: CheckpointService;
  taskProjector: TaskEventProjector;
  getTitleGenerationService: () => TaskTitleGenerationService | undefined;
  getRemoteControlService: () => RemoteControlService | undefined;
  logEvent: (data: Record<string, unknown>) => void;
  onPersistenceError: (data: Record<string, unknown>) => void;
  onTaskUpdated: (task: unknown) => void;
  onAgentEvent: (projectRoot: string, event: DesktopEvent) => void;
}

/** Owns the single main-process projection path for agent events. */
export class AgentEventCoordinator {
  constructor(private readonly options: AgentEventCoordinatorOptions) {}

  observe(projectRoot: string, event: DesktopEvent, isAutomationEvent: boolean): void {
    const executionCwd = typeof event.data['executionCwd'] === 'string' ? event.data['executionCwd'] : undefined;
    this.options.logEvent({ projectRoot, executionCwd, event: event.event, ...agentEventLogFields(event.data) });
    this.options.taskTurns.observe(typeof event.data['taskId'] === 'string' ? event.data['taskId'] : undefined, event);
    this.options.checkpoints.observeEvent(projectRoot, event);
    void this.options.taskProjector.apply(projectRoot, event)
      .then(() => this.options.getTitleGenerationService()?.observeTurnCompleted(projectRoot, event))
      .then(updated => { if (updated !== undefined) this.options.onTaskUpdated(updated); })
      .catch(error => this.options.onPersistenceError({ cwd: projectRoot, event: event.event, message: error instanceof Error ? error.message : 'Unable to persist agent event.' }))
      .finally(() => {
        const remoteControl = this.options.getRemoteControlService();
        remoteControl?.publishAgentEvent(projectRoot, event);
        remoteControl?.observeAgentEvent(event);
      });
    if (event.event !== 'approval.requested' && !isAutomationEvent) this.options.onAgentEvent(projectRoot, event);
  }
}

function agentEventLogFields(data: Record<string, unknown>): Record<string, unknown> {
  const fields: Record<string, string | number | boolean> = {};
  for (const key of ['taskId', 'sessionId', 'turnId', 'intentId', 'commandId', 'actionId', 'toolName'] as const) if (typeof data[key] === 'string') fields[key] = data[key];
  if (typeof data['exitCode'] === 'number') fields['exitCode'] = data['exitCode'];
  for (const key of ['success', 'isError'] as const) if (typeof data[key] === 'boolean') fields[key] = data[key];
  return fields;
}
