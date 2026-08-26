import type { DesktopEvent } from '../../contracts/agent-protocol/v1/desktop.js';
import type { TaskStore } from './task-store.js';

export class TaskEventProjector {
  private readonly queues = new Map<string, Promise<void>>();
  private readonly activeTasks = new Map<string, string>();

  constructor(private readonly tasks: TaskStore) {}

  async apply(cwd: string, event: DesktopEvent): Promise<void> {
    const previous = this.queues.get(cwd) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(() => this.applyNow(cwd, event));
    this.queues.set(cwd, next);
    try { await next; } finally { if (this.queues.get(cwd) === next) this.queues.delete(cwd); }
  }

  private async applyNow(cwd: string, event: DesktopEvent): Promise<void> {
    const sessionId = typeof event.data['sessionId'] === 'string' ? event.data['sessionId'] : undefined;
    const sessionTask = sessionId === undefined ? undefined : await this.tasks.findBySession(sessionId);
    const activeTaskId = this.activeTasks.get(cwd);
    const activeTask = activeTaskId === undefined ? undefined : await this.tasks.require(activeTaskId).then(value => value.archived || value.cwd !== cwd ? undefined : value).catch(() => undefined);
    const taskCandidate = sessionTask?.cwd === cwd ? sessionTask : sessionTask === undefined ? (sessionId === undefined ? activeTask : undefined) : undefined;
    const selectedTask = taskCandidate ?? (event.event === 'turn.started' ? await this.tasks.findByCwd(cwd) : undefined);
    if (selectedTask === undefined || selectedTask.archived || selectedTask.cwd !== cwd) return;
    const task = selectedTask;
    const data = event.data;
    const text = eventText(event.event, data);
    if (text !== undefined) {
      const metadata = redactMetadata(data);
      if (event.event === 'assistant.delta') await this.tasks.appendAssistantDelta(task.id, text, metadata);
      else await this.tasks.appendEvent(task.id, activityKind(event.event), text, metadata);
    }
    if (event.event === 'turn.started') {
      this.activeTasks.set(cwd, task.id);
      await this.tasks.setStatus(task.id, 'active');
      const turnId = typeof data['turnId'] === 'string' ? data['turnId'] : undefined;
      if (turnId !== undefined) await this.tasks.update(task.id, { turnId });
    }
    if (event.event === 'turn.completed') { await this.tasks.setStatus(task.id, 'completed'); await this.tasks.update(task.id, { turnId: undefined, interruptedReason: undefined }); this.clearActiveTask(cwd, task.id); }
    if (event.event === 'turn.failed') { await this.tasks.setStatus(task.id, 'failed'); await this.tasks.update(task.id, { turnId: undefined, interruptedReason: typeof data['error'] === 'string' ? redactString(data['error']) : 'The CLI reported a failed turn.' }); this.clearActiveTask(cwd, task.id); }
    if (event.event === 'turn.cancelled') { await this.tasks.setStatus(task.id, 'cancelled'); await this.tasks.update(task.id, { turnId: undefined }); this.clearActiveTask(cwd, task.id); }
  }

  private clearActiveTask(cwd: string, taskId: string): void { if (this.activeTasks.get(cwd) === taskId) this.activeTasks.delete(cwd); }
}

function eventText(event: string, data: Record<string, unknown>): string | undefined {
  if (event === 'assistant.delta') return typeof data['content'] === 'string' ? data['content'] : undefined;
  if (event === 'approval.requested') return `Approval requested for ${String(data['displayName'] ?? data['toolName'] ?? 'tool')}.`;
  if (event === 'trust.requested') return `Project trust requested for ${String(data['path'] ?? 'workspace')}.`;
  if (event === 'tool.started' || event === 'tool.completed') return `${event}: ${String(data['displayName'] ?? data['toolName'] ?? 'tool')}`;
  if (event === 'file.changed') return 'Workspace files changed.';
  if (event === 'command.output') return typeof data['content'] === 'string' ? data['content'] : 'Command output received.';
  if (event === 'context.compacted') return 'Agent context was compacted.';
  if (event === 'usage.updated') return 'Usage updated.';
  if (event === 'turn.failed') return failedTurnText(data);
  return undefined;
}

function failedTurnText(data: Record<string, unknown>): string {
  const error = data['error'];
  if (typeof error === 'object' && error !== null && typeof (error as Record<string, unknown>)['message'] === 'string') return `Agent turn failed: ${redactString((error as Record<string, unknown>)['message'] as string)}`;
  return 'Agent turn failed.';
}

function activityKind(event: string): 'assistant' | 'tool' | 'approval' | 'trust' | 'file' | 'command' | 'context' | 'usage' | 'error' {
  if (event === 'assistant.delta') return 'assistant';
  if (event.startsWith('approval')) return 'approval';
  if (event.startsWith('trust')) return 'trust';
  if (event.startsWith('tool')) return 'tool';
  if (event.startsWith('file')) return 'file';
  if (event.startsWith('command')) return 'command';
  if (event.startsWith('context')) return 'context';
  if (event.startsWith('usage')) return 'usage';
  if (event.includes('failed')) return 'error';
  return 'assistant';
}

function redactMetadata(data: Record<string, unknown>): Record<string, unknown> {
  return redactValue(data, 0) as Record<string, unknown>;
}

function redactValue(value: unknown, depth: number): unknown {
  if (typeof value === 'string') return redactString(value);
  if (depth >= 6) return '[REDACTED_DEPTH]';
  if (Array.isArray(value)) return value.slice(0, 128).map(item => redactValue(item, depth + 1));
  if (typeof value !== 'object' || value === null) return value;
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) result[key] = isSensitiveKey(key) ? '[REDACTED]' : redactValue(item, depth + 1);
  return result;
}

function redactString(value: string): string { return value.replace(/Bearer\s+[^\s]+/giu, 'Bearer [REDACTED]').replace(/sk-[A-Za-z0-9_-]{8,}/gu, '[REDACTED]').slice(0, 4_096); }
function isSensitiveKey(key: string): boolean { return /(?:token|secret|password|authorization|credential|cookie|api[-_]?key)/iu.test(key); }
