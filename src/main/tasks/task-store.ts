import { randomUUID } from 'node:crypto';
import { activitySchema, MAX_QUEUED_PROMPTS_PER_TASK, queuedPromptSchema, taskSchema, type Activity, type ActivityPage, type QueuedPrompt, type Task, type TaskStatus } from '../../contracts/ipc/v1/workspace.js';
import { ActivityLogStore } from '../persistence/activity-log-store.js';
import { JsonFileStore } from '../persistence/json-file-store.js';
import { desktopDataPath } from '../persistence/app-data-paths.js';

export type TaskUpdate = Partial<Pick<Task, 'title' | 'pinned' | 'archived' | 'draft' | 'draftAttachmentIds' | 'queuedPrompts' | 'sessionId' | 'turnId' | 'model' | 'lastEventCursor' | 'interruptedReason'>>;

export class TaskStore {
  private readonly taskStore = new JsonFileStore<Task[]>(desktopDataPath('tasks.json'), [], value => taskSchema.array().parse(value));
  private readonly activityStore = new ActivityLogStore(desktopDataPath('activities.jsonl'), desktopDataPath('activities.json'));

  async list(workspaceId?: string): Promise<Task[]> {
    const tasks = (await this.taskStore.read()).map(item => taskSchema.parse(item));
    return workspaceId === undefined ? tasks : tasks.filter(task => task.workspaceId === workspaceId);
  }

  async create(input: { workspaceId: string; title: string; cwd: string; titleSource?: Task['titleSource']; prompt?: string }): Promise<Task> {
    return this.withGlobalExclusive(async () => {
      const now = new Date().toISOString();
      const titleSource = input.titleSource ?? 'manual';
      const task = taskSchema.parse({ id: randomUUID(), workspaceId: input.workspaceId, title: input.title, titleSource, titleSummaryStatus: titleSource === 'automatic' ? 'not_started' : 'completed', cwd: input.cwd, status: 'queued', pinned: false, archived: false, draft: '', draftAttachmentIds: [], lastEventCursor: 0, createdAt: now, updatedAt: now });
      await this.taskStore.update(current => [...current, task]);
      if (input.prompt) await this.appendActivityInternal(task.id, 'user', input.prompt, {});
      return task;
    });
  }

  async update(taskId: string, patch: TaskUpdate): Promise<Task> {
    return this.withTaskExclusive(taskId, () => this.mutate(taskId, current => ({ ...current, ...patch, updatedAt: new Date().toISOString() })));
  }

  async queuedPrompts(taskId: string): Promise<QueuedPrompt[]> { return (await this.require(taskId)).queuedPrompts ?? []; }

  async queuePrompt(taskId: string, input: Omit<QueuedPrompt, 'id' | 'createdAt'>): Promise<QueuedPrompt> {
    const queued = queuedPromptSchema.parse({ ...input, id: randomUUID(), createdAt: new Date().toISOString() });
    await this.withTaskExclusive(taskId, () => this.mutate(taskId, current => {
      const prompts = current.queuedPrompts ?? [];
      if (current.archived) throw new Error('The selected task is archived.');
      if (prompts.length >= MAX_QUEUED_PROMPTS_PER_TASK) throw new Error('This task already has the maximum number of queued prompts.');
      return { ...current, queuedPrompts: [...prompts, queued], updatedAt: queued.createdAt };
    }));
    return queued;
  }

  async dequeuePrompt(taskId: string, promptId: string): Promise<QueuedPrompt | undefined> {
    let removed: QueuedPrompt | undefined;
    await this.withTaskExclusive(taskId, () => this.mutate(taskId, current => {
      const prompts = current.queuedPrompts ?? [];
      removed = prompts.find(prompt => prompt.id === promptId);
      return { ...current, queuedPrompts: prompts.filter(prompt => prompt.id !== promptId), updatedAt: new Date().toISOString() };
    }));
    return removed;
  }

  async rename(taskId: string, title: string): Promise<Task> {
    return this.withTaskExclusive(taskId, () => this.mutate(taskId, current => ({ ...current, title, titleSource: 'manual', titleSummaryStatus: 'completed', updatedAt: new Date().toISOString() })));
  }

  async claimAutomaticTitleSummary(taskId: string): Promise<Task | undefined> {
    return this.withTaskExclusive(taskId, async () => {
      let claimed: Task | undefined;
      await this.taskStore.update(current => current.map(task => {
        if (task.id !== taskId || task.titleSource !== 'automatic' || task.titleSummaryStatus !== 'not_started') return task;
        claimed = taskSchema.parse({ ...task, titleSummaryStatus: 'generating', updatedAt: new Date().toISOString() });
        return claimed;
      }));
      return claimed;
    });
  }

  async completeAutomaticTitleSummary(taskId: string, title: string): Promise<Task | undefined> {
    return this.withTaskExclusive(taskId, async () => {
      let completed: Task | undefined;
      await this.taskStore.update(current => current.map(task => {
        if (task.id !== taskId || task.titleSource !== 'automatic' || task.titleSummaryStatus !== 'generating') return task;
        completed = taskSchema.parse({ ...task, title, titleSummaryStatus: 'completed', updatedAt: new Date().toISOString() });
        return completed;
      }));
      return completed;
    });
  }

  async failAutomaticTitleSummary(taskId: string): Promise<Task | undefined> {
    return this.withTaskExclusive(taskId, async () => {
      let failed: Task | undefined;
      await this.taskStore.update(current => current.map(task => {
        if (task.id !== taskId || task.titleSource !== 'automatic' || task.titleSummaryStatus !== 'generating') return task;
        failed = taskSchema.parse({ ...task, titleSummaryStatus: 'failed', updatedAt: new Date().toISOString() });
        return failed;
      }));
      return failed;
    });
  }

  async setStatus(taskId: string, status: TaskStatus): Promise<Task> { return this.withTaskExclusive(taskId, () => this.mutate(taskId, current => ({ ...current, status, updatedAt: new Date().toISOString() }))); }
  async retry(taskId: string): Promise<Task> { return this.setStatus(taskId, 'queued'); }
  async cancel(taskId: string): Promise<Task> { return this.withTaskExclusive(taskId, () => this.mutate(taskId, current => ({ ...current, status: 'cancelled', turnId: undefined, updatedAt: new Date().toISOString() }))); }
  async resume(taskId: string): Promise<Task> { return this.setStatus(taskId, 'queued'); }
  async archive(taskId: string, archived: boolean): Promise<Task> { return this.update(taskId, { archived }); }
  async pin(taskId: string, pinned: boolean): Promise<Task> { return this.update(taskId, { pinned }); }

  async require(taskId: string): Promise<Task> {
    const task = (await this.taskStore.read()).find(item => item.id === taskId);
    if (task === undefined) throw new Error('Task was not found.');
    return task;
  }

  async requireForCwd(taskId: string, cwd: string): Promise<Task> {
    const task = await this.require(taskId);
    if (task.cwd !== cwd || task.archived) throw new Error('The task does not belong to this workspace.');
    return task;
  }

  async findByCwd(cwd: string): Promise<Task | undefined> { return (await this.taskStore.read()).filter(task => !task.archived && task.cwd === cwd).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]; }
  async findBySession(sessionId: string): Promise<Task | undefined> { return (await this.taskStore.read()).find(task => !task.archived && task.sessionId === sessionId); }

  async interruptActiveByCwd(cwd: string, reason: string): Promise<Task | undefined> {
    return this.withGlobalExclusive(async () => {
      let interrupted: Task | undefined;
      await this.taskStore.update(current => {
        const index = current.findIndex(task => !task.archived && task.cwd === cwd && task.status === 'active' && task.turnId !== undefined);
        if (index < 0) return current;
        const now = new Date().toISOString();
        interrupted = taskSchema.parse({ ...current[index], status: 'interrupted', turnId: undefined, interruptedReason: reason, updatedAt: now });
        const next = [...current]; next[index] = interrupted; return next;
      });
      return interrupted;
    });
  }

  async interruptActiveBySession(sessionId: string, reason: string): Promise<Task | undefined> {
    return this.withGlobalExclusive(async () => {
      let interrupted: Task | undefined;
      await this.taskStore.update(current => {
        const index = current.findIndex(task => !task.archived && task.sessionId === sessionId && task.status === 'active' && task.turnId !== undefined);
        if (index < 0) return current;
        const now = new Date().toISOString();
        interrupted = taskSchema.parse({ ...current[index], status: 'interrupted', turnId: undefined, interruptedReason: reason, updatedAt: now });
        const next = [...current]; next[index] = interrupted; return next;
      });
      return interrupted;
    });
  }

  async interruptActive(reason: string): Promise<readonly Task[]> {
    return this.withGlobalExclusive(async () => {
      const interrupted: Task[] = [];
      await this.taskStore.update(current => {
        const now = new Date().toISOString();
        const next = current.map(task => {
          if (task.archived || task.status !== 'active') return task;
          const updated = taskSchema.parse({ ...task, status: 'interrupted', turnId: undefined, interruptedReason: reason, updatedAt: now });
          interrupted.push(updated);
          return updated;
        });
        return next;
      });
      return interrupted;
    });
  }

  async appendActivity(taskId: string, kind: Activity['kind'], text: string, metadata: Record<string, unknown>): Promise<Activity> {
    return this.withTaskExclusive(taskId, () => this.appendActivityInternal(taskId, kind, text, metadata));
  }

  async appendAssistantDelta(taskId: string, text: string, metadata: Record<string, unknown>): Promise<Activity> {
    const [updated] = await this.appendAssistantDeltas(taskId, [{ text, metadata }]);
    if (updated === undefined) throw new Error('Assistant delta could not be persisted.');
    return updated;
  }

  async appendAssistantDeltas(taskId: string, deltas: readonly { text: string; metadata: Record<string, unknown> }[]): Promise<Activity[]> {
    return this.withTaskExclusive(taskId, async () => {
      const updated = await this.activityStore.appendAssistantDeltas(taskId, deltas);
      return updated;
    });
  }

  async completeAssistantSegment(taskId: string, segmentId: string, phase: 'progress' | 'final', metadata: Record<string, unknown> = {}): Promise<Activity | undefined> {
    return this.withTaskExclusive(taskId, () => this.activityStore.completeAssistantSegment(taskId, segmentId, phase, metadata));
  }

  async completeAssistantSegmentsForTurn(taskId: string, turnId: string, phase: 'progress' | 'final', metadata: Record<string, unknown> = {}): Promise<Activity[]> {
    return this.withTaskExclusive(taskId, () => this.activityStore.completeAssistantSegmentsForTurn(taskId, turnId, phase, metadata));
  }

  async replaceAssistantResponse(taskId: string, turnId: string, segmentId: string, text: string, metadata: Record<string, unknown>): Promise<Activity> {
    return this.withTaskExclusive(taskId, async () => {
      const updated = await this.activityStore.replaceAssistantResponse(taskId, turnId, segmentId, text, metadata);
      await this.taskStore.update(current => {
        const index = current.findIndex(task => task.id === taskId);
        if (index < 0) throw new Error('Task was not found.');
        const next = [...current];
        next[index] = taskSchema.parse({ ...next[index], updatedAt: updated.createdAt });
        return next;
      });
      return updated;
    });
  }

  private async appendActivityInternal(taskId: string, kind: Activity['kind'], text: string, metadata: Record<string, unknown>): Promise<Activity> {
    const activity = activitySchema.parse({ id: randomUUID(), taskId, kind, text, metadata, createdAt: new Date().toISOString() });
    await this.activityStore.append(activity);
    await this.taskStore.update(current => {
      const index = current.findIndex(task => task.id === taskId);
      if (index < 0) throw new Error('Task was not found.');
      const next = [...current];
      next[index] = taskSchema.parse({ ...next[index], updatedAt: activity.createdAt });
      return next;
    });
    return activity;
  }

  async appendEvent(taskId: string, kind: Activity['kind'], text: string, metadata: Record<string, unknown>): Promise<Activity> {
    return this.withTaskExclusive(taskId, async () => {
      const current = (await this.taskStore.read()).map(item => taskSchema.parse(item)).find(item => item.id === taskId);
      if (current === undefined) throw new Error('Task was not found.');
      const cursor = (current.lastEventCursor ?? 0) + 1;
      const activity = await this.appendActivityInternal(taskId, kind, text, { ...metadata, eventCursor: cursor });
      await this.mutate(taskId, item => ({ ...item, lastEventCursor: cursor, updatedAt: new Date().toISOString() }));
      return activity;
    });
  }

  async activities(taskId: string): Promise<Activity[]> { return (await this.activityStore.read()).filter(activity => activity.taskId === taskId).map(item => activitySchema.parse(item)); }

  async activitiesPage(taskId: string, options: { limit?: number; before?: string } = {}): Promise<ActivityPage> { return this.activityStore.readPage(taskId, options); }

  async dailyUsage(): Promise<Record<string, number>> {
    const totals = new Map<string, number>();
    for (const activity of await this.activityStore.read()) {
      if (activity.kind !== 'usage') continue;
      const tokens = usageTokens(activity.metadata['usage']);
      if (tokens <= 0) continue;
      const day = activity.createdAt.slice(0, 10);
      totals.set(day, (totals.get(day) ?? 0) + tokens);
    }
    return Object.fromEntries(totals);
  }

  private async mutate(taskId: string, update: (task: Task) => Task): Promise<Task> {
    let updated: Task | undefined;
    await this.taskStore.update(current => {
      const index = current.findIndex(task => task.id === taskId);
      if (index < 0) throw new Error('Task was not found.');
      updated = taskSchema.parse(update(taskSchema.parse(current[index])));
      const next = [...current];
      next[index] = updated;
      return next;
    });
    if (updated === undefined) throw new Error('Task update failed.');
    return updated;
  }

  private async withGlobalExclusive<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.globalMutationChain;
    let release!: () => void;
    this.globalMutationChain = new Promise<void>(resolve => { release = resolve; });
    await previous;
    try { return await operation(); } finally { release(); }
  }

  private async withTaskExclusive<T>(taskId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.taskMutationChains.get(taskId) ?? Promise.resolve();
    let release!: () => void;
    const next = new Promise<void>(resolve => { release = resolve; });
    this.taskMutationChains.set(taskId, next);
    await previous;
    try { return await operation(); }
    finally { release(); if (this.taskMutationChains.get(taskId) === next) this.taskMutationChains.delete(taskId); }
  }

  private readonly taskMutationChains = new Map<string, Promise<void>>();
  private globalMutationChain: Promise<void> = Promise.resolve();
}

export function paginateActivities(all: readonly Activity[], options: { limit?: number; before?: string } = {}): ActivityPage {
  const limit = Math.max(1, Math.min(options.limit ?? 40, 100));
  const beforeIndex = options.before === undefined ? all.length : all.findIndex(activity => activity.id === options.before);
  const end = beforeIndex < 0 ? all.length : beforeIndex;
  const start = Math.max(0, end - limit);
  const page = all.slice(start, end);
  return { activities: page, nextCursor: start > 0 ? page[0]?.id ?? null : null, hasMore: start > 0 };
}

function usageTokens(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, value);
  if (typeof value === 'string' && Number.isFinite(Number(value))) return Math.max(0, Number(value));
  if (typeof value !== 'object' || value === null) return 0;
  const record = value as Record<string, unknown>;
  const total = numberValue(record['totalTokens']);
  return total ?? (numberValue(record['promptTokens']) ?? 0) + (numberValue(record['completionTokens']) ?? 0);
}

function numberValue(value: unknown): number | undefined { return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : typeof value === 'string' && Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : undefined; }
