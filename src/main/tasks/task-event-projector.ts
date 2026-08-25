import type { DesktopEvent } from '../../contracts/agent-protocol/v1/desktop.js';
import type { TaskStore } from './task-store.js';

export class TaskEventProjector {
  private readonly queues = new Map<string, Promise<void>>();

  constructor(private readonly tasks: TaskStore) {}

  async apply(cwd: string, event: DesktopEvent): Promise<void> {
    const previous = this.queues.get(cwd) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(() => this.applyNow(cwd, event));
    this.queues.set(cwd, next);
    try { await next; } finally { if (this.queues.get(cwd) === next) this.queues.delete(cwd); }
  }

  private async applyNow(cwd: string, event: DesktopEvent): Promise<void> {
    const sessionId = typeof event.data['sessionId'] === 'string' ? event.data['sessionId'] : undefined;
    const task = (sessionId === undefined ? undefined : await this.tasks.findBySession(sessionId)) ?? await this.tasks.findByCwd(cwd);
    if (task === undefined) return;
    const data = event.data;
    const text = eventText(event.event, data);
    if (text !== undefined) {
      const metadata = redactMetadata(data);
      if (event.event === 'assistant.delta') await this.tasks.appendAssistantDelta(task.id, text, metadata);
      else await this.tasks.appendEvent(task.id, activityKind(event.event), text, metadata);
    }
    if (event.event === 'turn.started') await this.tasks.setStatus(task.id, 'active');
    if (event.event === 'turn.completed') { await this.tasks.setStatus(task.id, 'completed'); await this.tasks.update(task.id, { turnId: undefined, interruptedReason: undefined }); }
    if (event.event === 'turn.failed') await this.tasks.setStatus(task.id, 'failed');
    if (event.event === 'turn.cancelled') { await this.tasks.setStatus(task.id, 'cancelled'); await this.tasks.update(task.id, { turnId: undefined }); }
    if (event.event === 'turn.failed') await this.tasks.update(task.id, { interruptedReason: typeof data['error'] === 'string' ? data['error'] : 'The CLI reported a failed turn.' });
  }
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
  if (event === 'turn.failed') return 'Agent turn failed.';
  return undefined;
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
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) result[key] = typeof value === 'string' ? value.replace(/Bearer\s+[^\s]+/giu, 'Bearer [REDACTED]').replace(/sk-[A-Za-z0-9_-]{8,}/gu, '[REDACTED]').slice(0, 4_096) : value;
  return result;
}
