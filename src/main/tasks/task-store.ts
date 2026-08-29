import { randomUUID } from 'node:crypto';
import { activitySchema, taskSchema, type Activity, type ActivityPage, type Task, type TaskStatus } from '../../contracts/ipc/v1/workspace.js';
import { ActivityLogStore } from '../persistence/activity-log-store.js';
import { JsonFileStore } from '../persistence/json-file-store.js';
import { desktopDataPath } from '../persistence/app-data-paths.js';

export type TaskUpdate = Partial<Pick<Task, 'title' | 'pinned' | 'archived' | 'draft' | 'draftAttachmentIds' | 'sessionId' | 'turnId' | 'model' | 'lastEventCursor' | 'interruptedReason'>>;

export class TaskStore {
  private readonly taskStore = new JsonFileStore<Task[]>(desktopDataPath('tasks.json'), [], value => taskSchema.array().parse(value));
  private readonly activityStore = new ActivityLogStore(desktopDataPath('activities.jsonl'), desktopDataPath('activities.json'));

  async list(workspaceId?: string): Promise<Task[]> {
    const tasks = (await this.taskStore.read()).map(item => taskSchema.parse(item));
    return workspaceId === undefined ? tasks : tasks.filter(task => task.workspaceId === workspaceId);
  }

  async create(input: { workspaceId: string; title: string; cwd: string; prompt?: string }): Promise<Task> {
    return this.withExclusive(async () => {
      const now = new Date().toISOString();
      const task = taskSchema.parse({ id: randomUUID(), workspaceId: input.workspaceId, title: input.title, cwd: input.cwd, status: 'queued', pinned: false, archived: false, draft: '', draftAttachmentIds: [], lastEventCursor: 0, createdAt: now, updatedAt: now });
      await this.taskStore.update(current => [...current, task]);
      if (input.prompt) await this.appendActivityInternal(task.id, 'user', input.prompt, {});
      return task;
    });
  }

  async update(taskId: string, patch: TaskUpdate): Promise<Task> {
    return this.withExclusive(() => this.mutate(taskId, current => ({ ...current, ...patch, updatedAt: new Date().toISOString() })));
  }

  async setStatus(taskId: string, status: TaskStatus): Promise<Task> { return this.withExclusive(() => this.mutate(taskId, current => ({ ...current, status, updatedAt: new Date().toISOString() }))); }
  async retry(taskId: string): Promise<Task> { return this.setStatus(taskId, 'queued'); }
  async cancel(taskId: string): Promise<Task> { return this.withExclusive(() => this.mutate(taskId, current => ({ ...current, status: 'cancelled', turnId: undefined, updatedAt: new Date().toISOString() }))); }
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
    return this.withExclusive(async () => {
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

  async appendActivity(taskId: string, kind: Activity['kind'], text: string, metadata: Record<string, unknown>): Promise<Activity> {
    return this.withExclusive(() => this.appendActivityInternal(taskId, kind, text, metadata));
  }

  async appendAssistantDelta(taskId: string, text: string, metadata: Record<string, unknown>): Promise<Activity> {
    return this.withExclusive(async () => {
      const updated = await this.activityStore.appendAssistantDelta(taskId, text, metadata);
      return updated ?? this.appendActivityInternal(taskId, 'assistant', text, metadata);
    });
  }

  async completeAssistantSegment(taskId: string, segmentId: string, phase: 'progress' | 'final'): Promise<Activity | undefined> {
    return this.withExclusive(() => this.activityStore.completeAssistantSegment(taskId, segmentId, phase));
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
    return this.withExclusive(async () => {
      const current = (await this.taskStore.read()).map(item => taskSchema.parse(item)).find(item => item.id === taskId);
      if (current === undefined) throw new Error('Task was not found.');
      const cursor = (current.lastEventCursor ?? 0) + 1;
      const activity = await this.appendActivityInternal(taskId, kind, text, { ...metadata, eventCursor: cursor });
      await this.mutate(taskId, item => ({ ...item, lastEventCursor: cursor, updatedAt: new Date().toISOString() }));
      return activity;
    });
  }

  async activities(taskId: string): Promise<Activity[]> { return (await this.activityStore.read()).filter(activity => activity.taskId === taskId).map(item => activitySchema.parse(item)); }

  async activitiesPage(taskId: string, options: { limit?: number; before?: string } = {}): Promise<ActivityPage> { return paginateActivities(await this.activities(taskId), options); }

  private async mutate(taskId: string, update: (task: Task) => Task): Promise<Task> {
    const current = await this.taskStore.read();
    const index = current.findIndex(task => task.id === taskId);
    if (index < 0) throw new Error('Task was not found.');
    const updated = taskSchema.parse(update(current[index]!));
    const next = [...current];
    next[index] = updated;
    await this.taskStore.write(next);
    return updated;
  }

  private async withExclusive<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.mutationChain;
    let release!: () => void;
    this.mutationChain = new Promise<void>(resolve => { release = resolve; });
    await previous;
    try { return await operation(); } finally { release(); }
  }

  private mutationChain: Promise<void> = Promise.resolve();
}

export function paginateActivities(all: readonly Activity[], options: { limit?: number; before?: string } = {}): ActivityPage {
  const limit = Math.max(1, Math.min(options.limit ?? 40, 100));
  const beforeIndex = options.before === undefined ? all.length : all.findIndex(activity => activity.id === options.before);
  const end = beforeIndex < 0 ? all.length : beforeIndex;
  const start = Math.max(0, end - limit);
  const page = all.slice(start, end);
  return { activities: page, nextCursor: start > 0 ? page[0]?.id ?? null : null, hasMore: start > 0 };
}
