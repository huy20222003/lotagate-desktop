import { DESKTOP_TURN_TIMING_METADATA_KEY, type DesktopTurnTimingMarker } from '../../contracts/ipc/v1/workspace.js';
import type { DesktopEvent } from '../../contracts/agent-protocol/v1/desktop.js';
import { formatToolDisplayName } from '../../shared/tool-display.js';
import type { TaskStore } from './task-store.js';

const ASSISTANT_DELTA_BATCH_WINDOW_MS = 32;
const ASSISTANT_DELTA_BATCH_SIZE = 32;

interface PendingAssistantDeltaBatch {
  cwd: string;
  events: DesktopEvent[];
}

export class TaskEventProjector {
  private readonly queues = new Map<string, Promise<void>>();
  private readonly activeTasks = new Map<string, string>();
  private readonly pendingAssistantDeltas = new Map<string, PendingAssistantDeltaBatch>();
  private readonly deltaTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(private readonly tasks: TaskStore, private readonly onError: (error: unknown, cwd: string) => void = () => undefined) {}

  async apply(cwd: string, event: DesktopEvent): Promise<void> {
    if (event.event === 'assistant.delta') {
      await this.bufferAssistantDelta(cwd, event);
      return;
    }
    await this.flushAssistantDeltas(cwd);
    await this.enqueue(cwd, () => this.applyNow(cwd, event));
  }

  async flush(): Promise<void> {
    const cwds = new Set([...this.pendingAssistantDeltas.values()].map(batch => batch.cwd));
    for (const cwd of cwds) await this.flushAssistantDeltas(cwd);
    await Promise.all([...this.queues.values()].map(queue => queue.catch(() => undefined)));
  }

  private async bufferAssistantDelta(cwd: string, event: DesktopEvent): Promise<void> {
    const key = `${cwd}\u0000${String(event.data['sessionId'] ?? '')}\u0000${String(event.data['turnId'] ?? '')}\u0000${String(event.data['segmentId'] ?? '')}`;
    const batch = this.pendingAssistantDeltas.get(key) ?? { cwd, events: [] };
    batch.events.push(event);
    this.pendingAssistantDeltas.set(key, batch);
    if (batch.events.length >= ASSISTANT_DELTA_BATCH_SIZE) {
      await this.flushAssistantDeltaBatch(key);
      return;
    }
    if (this.deltaTimers.has(key)) return;
    this.deltaTimers.set(key, setTimeout(() => {
      this.deltaTimers.delete(key);
      void this.flushAssistantDeltaBatch(key).catch(error => this.onError(error, cwd));
    }, ASSISTANT_DELTA_BATCH_WINDOW_MS));
  }

  private async flushAssistantDeltas(cwd: string): Promise<void> {
    const keys = [...this.pendingAssistantDeltas.entries()].filter(([, batch]) => batch.cwd === cwd).map(([key]) => key);
    for (const key of keys) await this.flushAssistantDeltaBatch(key);
  }

  private async flushAssistantDeltaBatch(key: string): Promise<void> {
    const timer = this.deltaTimers.get(key);
    if (timer !== undefined) { clearTimeout(timer); this.deltaTimers.delete(key); }
    const batch = this.pendingAssistantDeltas.get(key);
    if (batch === undefined || batch.events.length === 0) return;
    this.pendingAssistantDeltas.delete(key);
    await this.enqueue(batch.cwd, () => this.applyAssistantDeltaBatch(batch.cwd, batch.events));
  }

  private async enqueue(cwd: string, operation: () => Promise<void>): Promise<void> {
    const previous = this.queues.get(cwd) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(operation);
    this.queues.set(cwd, next);
    try { await next; } finally { if (this.queues.get(cwd) === next) this.queues.delete(cwd); }
  }

  private async applyAssistantDeltaBatch(cwd: string, events: readonly DesktopEvent[]): Promise<void> {
    const first = events[0];
    if (first === undefined) return;
    const task = await this.selectTask(cwd, first);
    if (task === undefined) return;
    const deltas = events.flatMap(event => {
      const text = eventText(event.event, event.data);
      if (text === undefined) return [];
      return [{ text, metadata: { ...redactMetadata(event.data), assistantPhase: 'progress' } }];
    });
    await this.tasks.appendAssistantDeltas(task.id, deltas);
  }

  private async applyNow(cwd: string, event: DesktopEvent): Promise<void> {
    const task = await this.selectTask(cwd, event);
    if (task === undefined) return;
    const data = event.data;
    const timing = turnTimingMarker(event.event, data);
    if (timing !== undefined) await this.tasks.appendEvent(task.id, 'context', 'Desktop turn timing marker.', { turnId: data['turnId'], [DESKTOP_TURN_TIMING_METADATA_KEY]: timing });
    if (event.event === 'assistant.segment.completed' && typeof data['segmentId'] === 'string' && (data['phase'] === 'progress' || data['phase'] === 'final')) {
      await this.tasks.completeAssistantSegment(task.id, data['segmentId'], data['phase']);
    }
    const text = eventText(event.event, data);
    if (text !== undefined) {
      const metadata = event.event === 'assistant.delta' ? { ...redactMetadata(data), assistantPhase: 'progress' } : redactMetadata(data);
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

  private async selectTask(cwd: string, event: DesktopEvent): Promise<Awaited<ReturnType<TaskStore['require']>> | undefined> {
    const taskId = typeof event.data['taskId'] === 'string' ? event.data['taskId'] : undefined;
    const directTask = taskId === undefined ? undefined : await this.tasks.require(taskId).then(task => task.cwd === cwd ? task : undefined).catch(() => undefined);
    if (directTask !== undefined) return directTask;
    const sessionId = typeof event.data['sessionId'] === 'string' ? event.data['sessionId'] : undefined;
    const sessionTask = sessionId === undefined ? undefined : await this.tasks.findBySession(sessionId);
    const activeTaskId = this.activeTasks.get(cwd);
    const activeTask = activeTaskId === undefined ? undefined : await this.tasks.require(activeTaskId).then(value => value.archived || value.cwd !== cwd ? undefined : value).catch(() => undefined);
    const taskCandidate = sessionTask?.cwd === cwd ? sessionTask : sessionTask === undefined ? (sessionId === undefined ? activeTask : undefined) : undefined;
    const selectedTask = taskCandidate ?? (event.event === 'turn.started' ? await this.tasks.findByCwd(cwd) : undefined);
    if (selectedTask === undefined || selectedTask.archived || selectedTask.cwd !== cwd) return undefined;
    return selectedTask;
  }

  private clearActiveTask(cwd: string, taskId: string): void { if (this.activeTasks.get(cwd) === taskId) this.activeTasks.delete(cwd); }
}

function eventText(event: string, data: Record<string, unknown>): string | undefined {
  if (event === 'assistant.delta') return typeof data['content'] === 'string' ? data['content'] : undefined;
  if (event === 'approval.requested') return `Approval requested for ${formatToolDisplayName(data['toolName'], data['displayName'])}.`;
  if (event === 'trust.requested') return `Project trust requested for ${String(data['path'] ?? 'workspace')}.`;
  if (event === 'tool.started') return `Running ${formatToolDisplayName(data['toolName'], data['displayName'])}.`;
  if (event === 'tool.completed') return data['isError'] === true
    ? `${formatToolDisplayName(data['toolName'], data['displayName'])} failed.`
    : `${formatToolDisplayName(data['toolName'], data['displayName'])} completed.`;
  if (event === 'file.changed') return 'Workspace files changed.';
  // Command output is a transport detail. The command runner creates the
  // final assistant activity after completion; persisting each output event
  // here leaves stale command text in the activity log and can replay it on
  // the next application start.
  if (event.startsWith('command.')) return undefined;
  if (event === 'context.compacted') return 'Agent context was compacted.';
  if (event === 'usage.updated') return 'Usage updated.';
  if (event === 'turn.failed') return failedTurnText(data);
  return undefined;
}

function turnTimingMarker(event: string, data: Record<string, unknown>): DesktopTurnTimingMarker | undefined {
  const phase = event === 'turn.started' ? 'started' : event === 'turn.completed' ? 'completed' : event === 'turn.failed' ? 'failed' : event === 'turn.cancelled' ? 'cancelled' : undefined;
  if (phase === undefined || typeof data['turnId'] !== 'string' || data['turnId'].length === 0) return undefined;
  return { phase, timestampMs: Date.now() };
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
