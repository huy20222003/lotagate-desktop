import { randomUUID } from 'node:crypto';
import { activitySchema, taskSchema, type Activity, type Task, type TaskStatus } from '../../contracts/ipc/v1/workspace.js';
import { JsonFileStore } from '../persistence/json-file-store.js';
import { desktopDataPath } from '../persistence/app-data-paths.js';

export class TaskStore {
  private readonly taskStore = new JsonFileStore<Task[]>(desktopDataPath('tasks.json'), [], value => taskSchema.array().parse(value));
  private readonly activityStore = new JsonFileStore<Activity[]>(desktopDataPath('activities.json'), [], value => activitySchema.array().parse(value));

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

  async update(taskId: string, patch: Partial<Pick<Task, 'title' | 'pinned' | 'archived' | 'draft' | 'draftAttachmentIds' | 'sessionId' | 'turnId' | 'model' | 'lastEventCursor' | 'interruptedReason'>>): Promise<Task> {
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

  async findByCwd(cwd: string): Promise<Task | undefined> { return (await this.taskStore.read()).filter(task => !task.archived && task.cwd === cwd).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]; }
  async findBySession(sessionId: string): Promise<Task | undefined> { return (await this.taskStore.read()).find(task => !task.archived && task.sessionId === sessionId); }

  async appendActivity(taskId: string, kind: Activity['kind'], text: string, metadata: Record<string, unknown>): Promise<Activity> {
    return this.withExclusive(() => this.appendActivityInternal(taskId, kind, text, metadata));
  }

  async appendAssistantDelta(taskId: string, text: string, metadata: Record<string, unknown>): Promise<Activity> {
    return this.withExclusive(async () => {
      const current = await this.activityStore.read();
      const turnId = metadata['turnId'];
      const index = [...current].reverse().findIndex(activity => activity.taskId === taskId && activity.kind === 'assistant' && activity.metadata['turnId'] === turnId);
      if (index < 0) return this.appendActivityInternal(taskId, 'assistant', text, metadata);
      const actualIndex = current.length - index - 1;
      const previous = activitySchema.parse(current[actualIndex]);
      const updated = activitySchema.parse({ ...previous, text: `${previous.text}${text}`, metadata: { ...previous.metadata, ...metadata } });
      const next = [...current]; next[actualIndex] = updated;
      await this.activityStore.write(next);
      return updated;
    });
  }

  private async appendActivityInternal(taskId: string, kind: Activity['kind'], text: string, metadata: Record<string, unknown>): Promise<Activity> {
    const activity = activitySchema.parse({ id: randomUUID(), taskId, kind, text, metadata, createdAt: new Date().toISOString() });
    await this.activityStore.update(current => [...current, activity]);
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
