import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { z } from 'zod';
import { activitySchema, type Activity, type ActivityPage } from '../../contracts/ipc/v1/workspace.js';
import { mergeAssistantText, normalizeAssistantText } from '../../shared/assistant-stream-text.js';
import { renameWithRetry } from './atomic-file-operations.js';
import { ACTIVITY_LOG_VERSION, DEFAULT_COMPACTION_BYTES, DEFAULT_COMPACTION_OPERATIONS } from './persistence-constants.js';

const activityAppendRecordSchema = z.object({
  version: z.literal(ACTIVITY_LOG_VERSION),
  type: z.literal('append'),
  sequence: z.number().int().nonnegative(),
  activity: activitySchema,
});

const activityDeltaRecordSchema = z.object({
  version: z.literal(ACTIVITY_LOG_VERSION),
  type: z.literal('assistant.delta'),
  sequence: z.number().int().nonnegative(),
  taskId: z.string().min(1),
  turnId: z.unknown().optional(),
  text: z.string(),
  metadata: z.record(z.string(), z.unknown()),
});

const activitySegmentCompletedRecordSchema = z.object({
  version: z.literal(ACTIVITY_LOG_VERSION),
  type: z.literal('assistant.segment.completed'),
  sequence: z.number().int().nonnegative(),
  taskId: z.string().min(1),
  segmentId: z.string().min(1),
  phase: z.enum(['progress', 'final']),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const activitySnapshotRecordSchema = z.object({
  version: z.literal(ACTIVITY_LOG_VERSION),
  type: z.literal('snapshot'),
  sequence: z.number().int().nonnegative(),
  activities: activitySchema.array(),
});

const activityLogRecordSchema = z.discriminatedUnion('type', [
  activityAppendRecordSchema,
  activityDeltaRecordSchema,
  activitySegmentCompletedRecordSchema,
  activitySnapshotRecordSchema,
]);

type ActivityLogRecord = z.infer<typeof activityLogRecordSchema>;

export interface ActivityLogStoreOptions {
  compactionBytes?: number;
  compactionOperations?: number;
}

export class ActivityLogStore {
  private readonly compactionBytes: number;
  private readonly compactionOperations: number;
  private writeChain: Promise<void> = Promise.resolve();
  private loaded = false;
  private sequence = 0;
  private bytesSinceSnapshot = 0;
  private operationsSinceSnapshot = 0;

  constructor(
    private readonly filePath: string,
    private readonly legacyPath?: string,
    options: ActivityLogStoreOptions = {},
  ) {
    this.compactionBytes = options.compactionBytes ?? DEFAULT_COMPACTION_BYTES;
    this.compactionOperations = options.compactionOperations ?? DEFAULT_COMPACTION_OPERATIONS;
  }

  async read(): Promise<Activity[]> {
    await this.writeChain;
    return this.readAll();
  }

  async readPage(taskId: string, options: { limit?: number; before?: string } = {}): Promise<ActivityPage> {
    const activities = await this.read();
    const limit = Math.max(1, Math.min(options.limit ?? 40, 100));
    const collected: Activity[] = [];
    const cursorIndex = options.before === undefined ? -1 : activities.findIndex(activity => activity.taskId === taskId && activity.id === options.before);
    const startIndex = cursorIndex < 0 ? activities.length - 1 : cursorIndex - 1;
    for (let index = startIndex; index >= 0; index -= 1) {
      const activity = activities[index]!;
      if (activity.taskId !== taskId) continue;
      collected.push(activity);
      if (collected.length > limit) break;
    }
    const hasMore = collected.length > limit;
    const pageActivities = collected.slice(0, limit).reverse();
    return { activities: pageActivities, nextCursor: hasMore ? pageActivities[0]?.id ?? null : null, hasMore };
  }

  async append(activity: Activity): Promise<void> {
    await this.enqueue(async () => {
      await this.ensureLoaded();
      await this.compactIfNeeded();
      const nextSequence = this.sequence + 1;
      const normalizedActivity = normalizeActivity(activity);
      const record: ActivityLogRecord = { version: ACTIVITY_LOG_VERSION, type: 'append', sequence: nextSequence, activity: normalizedActivity };
      await this.appendRecord(record);
      this.sequence = nextSequence;
      this.recordOperation(record);
    });
  }

  async appendAssistantDelta(taskId: string, text: string, metadata: Record<string, unknown>): Promise<Activity | undefined> {
    const [updated] = await this.appendAssistantDeltas(taskId, [{ text, metadata }]);
    return updated;
  }

  async appendAssistantDeltas(taskId: string, deltas: readonly { text: string; metadata: Record<string, unknown> }[]): Promise<Activity[]> {
    const updated: Activity[] = [];
    await this.enqueue(async () => {
      if (deltas.length === 0) return;
      await this.ensureLoaded();
      await this.compactIfNeeded();
      const next = await this.readAll();
      const records: ActivityLogRecord[] = [];
      for (const delta of deltas) {
        const turnId = delta.metadata['turnId'];
        const actualIndex = findAssistantIndex(next, taskId, turnId, delta.metadata['segmentId']);
        const previous = actualIndex < 0 ? undefined : activitySchema.parse(next[actualIndex]);
        const nextActivity = previous === undefined
          ? activitySchema.parse({ id: `streaming:${randomUUID()}`, taskId, kind: 'assistant', text: normalizeAssistantText(delta.text), metadata: delta.metadata, createdAt: new Date().toISOString() })
          : activitySchema.parse({ ...previous, text: mergeAssistantText(previous.text, delta.text), metadata: { ...previous.metadata, ...delta.metadata } });
        if (actualIndex < 0) next.push(nextActivity);
        else next[actualIndex] = nextActivity;
        const record: ActivityLogRecord = previous === undefined
          ? { version: ACTIVITY_LOG_VERSION, type: 'append', sequence: this.sequence + records.length + 1, activity: nextActivity }
          : { version: ACTIVITY_LOG_VERSION, type: 'assistant.delta', sequence: this.sequence + records.length + 1, taskId, ...(turnId === undefined ? {} : { turnId }), text: delta.text, metadata: delta.metadata };
        records.push(record);
        updated.push(nextActivity);
      }
      await this.appendRecords(records, { sync: false });
      this.sequence = records[records.length - 1]?.sequence ?? this.sequence;
      for (const record of records) this.recordOperation(record);
    });
    return updated;
  }

  async completeAssistantSegment(taskId: string, segmentId: string, phase: 'progress' | 'final', metadata: Record<string, unknown> = {}): Promise<Activity | undefined> {
    let updated: Activity | undefined;
    await this.enqueue(async () => {
      await this.ensureLoaded();
      await this.compactIfNeeded();
      const activities = await this.readAll();
      const actualIndex = activities.findIndex(activity => activity.taskId === taskId && activity.kind === 'assistant' && activity.metadata['segmentId'] === segmentId);
      if (actualIndex < 0) return;
      const previous = activitySchema.parse(activities[actualIndex]);
      const nextMetadata = { ...previous.metadata, ...metadata, assistantPhase: phase };
      if (previous.metadata['assistantPhase'] === phase && Object.keys(metadata).every(key => previous.metadata[key] === metadata[key])) { updated = previous; return; }
      updated = activitySchema.parse({ ...previous, metadata: nextMetadata });
      const record: ActivityLogRecord = { version: ACTIVITY_LOG_VERSION, type: 'assistant.segment.completed', sequence: this.sequence + 1, taskId, segmentId, phase, ...(Object.keys(metadata).length === 0 ? {} : { metadata }) };
      await this.appendRecord(record);
      const next = [...activities];
      next[actualIndex] = updated;
      this.sequence = record.sequence;
      this.recordOperation(record);
    });
    return updated;
  }

  async completeAssistantSegmentsForTurn(taskId: string, turnId: string, phase: 'progress' | 'final', metadata: Record<string, unknown> = {}): Promise<Activity[]> {
    const updated: Activity[] = [];
    await this.enqueue(async () => {
      await this.ensureLoaded();
      await this.compactIfNeeded();
      const next = await this.readAll();
      const records: ActivityLogRecord[] = [];
      for (const [index, activity] of next.entries()) {
        if (activity.taskId !== taskId || activity.kind !== 'assistant' || activity.metadata['turnId'] !== turnId || activity.metadata['assistantPhase'] !== 'progress') continue;
        const segmentId = activity.metadata['segmentId'];
        if (typeof segmentId !== 'string' || segmentId.length === 0) continue;
        const previous = activitySchema.parse(activity);
        const changed = activitySchema.parse({ ...previous, metadata: { ...previous.metadata, ...metadata, assistantPhase: phase } });
        const record: ActivityLogRecord = { version: ACTIVITY_LOG_VERSION, type: 'assistant.segment.completed', sequence: this.sequence + records.length + 1, taskId, segmentId, phase, ...(Object.keys(metadata).length === 0 ? {} : { metadata }) };
        next[index] = changed;
        updated.push(changed);
        records.push(record);
      }
      if (records.length === 0) return;
      await this.appendRecords(records);
      this.sequence = records[records.length - 1]!.sequence;
      for (const record of records) this.recordOperation(record);
    });
    return updated;
  }

  async replaceAssistantResponse(taskId: string, turnId: string, segmentId: string, text: string, metadata: Record<string, unknown>): Promise<Activity> {
    let updated: Activity | undefined;
    await this.enqueue(async () => {
      await this.ensureLoaded();
      const current = await this.readAll();
      const replacementId = assistantReplacementId(taskId, segmentId);
      const existing = current.find(activity => activity.id === replacementId);
      const replacement = activitySchema.parse({
        id: replacementId,
        taskId,
        kind: 'assistant',
        text: normalizeAssistantText(text),
        metadata: { ...metadata, turnId, segmentId, assistantPhase: 'final', assistantReplacement: true },
        createdAt: existing?.createdAt ?? new Date().toISOString(),
      });
      const next = current
        .filter(activity => activity.id !== replacementId)
        .map(activity => activity.taskId === taskId && activity.kind === 'assistant' && activity.metadata['turnId'] === turnId
          ? { ...activity, metadata: { ...activity.metadata, assistantPhase: 'progress' } }
          : activity);
      next.push(replacement);
      await this.writeSnapshot(next.map(activity => activitySchema.parse(activity)));
      updated = replacement;
    });
    if (updated === undefined) throw new Error('Assistant response replacement could not be persisted.');
    return updated;
  }

  private async enqueue(operation: () => Promise<void>): Promise<void> {
    const next = this.writeChain.catch(() => undefined).then(operation);
    this.writeChain = next;
    await next;
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    let raw: string;
    try {
      raw = await readFile(this.filePath, 'utf8');
    } catch (error) {
      if (!isMissingFile(error)) throw error;
      await this.importLegacyIfPresent();
      this.loaded = true;
      return;
    }
    await this.replayMetadata(raw);
    this.loaded = true;
  }

  private async readAll(): Promise<Activity[]> {
    await this.ensureLoaded();
    let raw: string;
    try { raw = await readFile(this.filePath, 'utf8'); }
    catch (error) { if (isMissingFile(error)) return []; throw error; }
    return this.replay(raw);
  }

  private async importLegacyIfPresent(): Promise<void> {
    if (this.legacyPath === undefined) return;
    let raw: string;
    try {
      raw = await readFile(this.legacyPath, 'utf8');
    } catch (error) {
      if (isMissingFile(error)) return;
      throw error;
    }
    const activities = activitySchema.array().parse(JSON.parse(raw)).map(normalizeActivity);
    this.sequence = 0;
    await this.writeSnapshot(activities);
  }

  private async replayMetadata(raw: string): Promise<void> {
    let sequence = -1;
    let bytesSinceSnapshot = 0;
    let operationsSinceSnapshot = 0;
    const lines = raw.split(/\r?\n/u);
    const lastRecordIndex = lines.reduce((lastIndex, line, index) => line.trim() === '' ? lastIndex : index, -1);
    const validLines: string[] = [];
    for (const [index, line] of lines.entries()) {
      if (line.trim() === '') continue;
      let record: ActivityLogRecord;
      try { record = activityLogRecordSchema.parse(JSON.parse(line)); }
      catch (error) {
        if (index !== lastRecordIndex) throw new Error(`Activity log record ${index + 1} is invalid.`, { cause: error });
        await this.repairTrailingRecord(validLines);
        break;
      }
      if (record.sequence <= sequence) throw new Error('Activity log sequence is not strictly increasing.');
      validLines.push(line);
      if (record.type === 'snapshot') { bytesSinceSnapshot = 0; operationsSinceSnapshot = 0; }
      else { bytesSinceSnapshot += Buffer.byteLength(`${line}\n`, 'utf8'); operationsSinceSnapshot += 1; }
      sequence = record.sequence;
    }
    this.sequence = Math.max(sequence, 0);
    this.bytesSinceSnapshot = bytesSinceSnapshot;
    this.operationsSinceSnapshot = operationsSinceSnapshot;
  }

  private async replay(raw: string): Promise<Activity[]> {
    let activities: Activity[] = [];
    let sequence = -1;
    let bytesSinceSnapshot = 0;
    let operationsSinceSnapshot = 0;
    const lines = raw.split(/\r?\n/u);
    const lastRecordIndex = lines.reduce((lastIndex, line, index) => line.trim() === '' ? lastIndex : index, -1);
    const validLines: string[] = [];
    for (const [index, line] of lines.entries()) {
      if (line.trim() === '') continue;
      let record: ActivityLogRecord;
      try {
        record = activityLogRecordSchema.parse(JSON.parse(line));
      } catch (error) {
        if (index !== lastRecordIndex) throw new Error(`Activity log record ${index + 1} is invalid.`, { cause: error });
        await this.repairTrailingRecord(validLines);
        break;
      }
      if (record.sequence <= sequence) throw new Error('Activity log sequence is not strictly increasing.');
      validLines.push(line);
      if (record.type === 'snapshot') {
        activities = record.activities;
        bytesSinceSnapshot = 0;
        operationsSinceSnapshot = 0;
      } else if (record.type === 'append') {
        activities = [...activities, record.activity];
        bytesSinceSnapshot += Buffer.byteLength(`${line}\n`, 'utf8');
        operationsSinceSnapshot += 1;
      } else if (record.type === 'assistant.delta') {
        activities = applyAssistantDelta(activities, record.taskId, record.turnId, record.text, record.metadata);
        bytesSinceSnapshot += Buffer.byteLength(`${line}\n`, 'utf8');
        operationsSinceSnapshot += 1;
      } else {
        activities = applyAssistantSegmentCompleted(activities, record.taskId, record.segmentId, record.phase, record.metadata);
        bytesSinceSnapshot += Buffer.byteLength(`${line}\n`, 'utf8');
        operationsSinceSnapshot += 1;
      }
      sequence = record.sequence;
    }
    const normalizedActivities = activitySchema.array().parse(activities.map(normalizeActivity));
    this.sequence = Math.max(sequence, 0);
    this.bytesSinceSnapshot = bytesSinceSnapshot;
    this.operationsSinceSnapshot = operationsSinceSnapshot;
    return normalizedActivities;
  }

  private async repairTrailingRecord(validLines: string[]): Promise<void> {
    const raw = validLines.length === 0 ? '' : `${validLines.join('\n')}\n`;
    const temporary = `${this.filePath}.${process.pid}.repair.tmp`;
    await writeFile(temporary, raw, 'utf8');
    await renameWithRetry(temporary, this.filePath);
  }

  private async appendRecord(record: ActivityLogRecord): Promise<void> {
    await this.appendRecords([record]);
  }

  private async appendRecords(records: readonly ActivityLogRecord[], options: { sync?: boolean } = {}): Promise<void> {
    if (records.length === 0) return;
    await mkdir(dirname(this.filePath), { recursive: true });
    const handle = await open(this.filePath, 'a');
    try {
      await handle.write(`${records.map(record => JSON.stringify(record)).join('\n')}\n`, null, 'utf8');
      if (options.sync !== false) {
        await handle.sync();
      }
    } finally {
      await handle.close();
    }
  }

  private recordOperation(record: ActivityLogRecord): void {
    if (record.type === 'snapshot') {
      this.bytesSinceSnapshot = 0;
      this.operationsSinceSnapshot = 0;
      return;
    }
    this.bytesSinceSnapshot += Buffer.byteLength(`${JSON.stringify(record)}\n`, 'utf8');
    this.operationsSinceSnapshot += 1;
  }

  private async compactIfNeeded(): Promise<void> {
    if (this.operationsSinceSnapshot === 0) return;
    if (this.bytesSinceSnapshot < this.compactionBytes && this.operationsSinceSnapshot < this.compactionOperations) return;
    await this.writeSnapshot();
  }

  private async writeSnapshot(activities?: readonly Activity[]): Promise<void> {
    const snapshot = activities === undefined ? await this.readAll() : activities;
    const record: ActivityLogRecord = { version: ACTIVITY_LOG_VERSION, type: 'snapshot', sequence: this.sequence, activities: [...snapshot] };
    const raw = `${JSON.stringify(record)}\n`;
    await mkdir(dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.${process.pid}.snapshot.tmp`;
    await writeFile(temporary, raw, 'utf8');
    await renameWithRetry(temporary, this.filePath);
    this.recordOperation(record);
  }
}

function findAssistantIndex(activities: Activity[], taskId: string, turnId: unknown, segmentId?: unknown): number {
  for (let index = activities.length - 1; index >= 0; index -= 1) {
    const activity = activities[index]!;
    if (activity.taskId !== taskId || activity.kind !== 'assistant') continue;
    if (segmentId !== undefined && activity.metadata['segmentId'] === segmentId) return index;
    if (segmentId === undefined && activity.metadata['turnId'] === turnId) return index;
  }
  return -1;
}

function applyAssistantDelta(activities: Activity[], taskId: string, turnId: unknown, text: string, metadata: Record<string, unknown>): Activity[] {
  const actualIndex = findAssistantIndex(activities, taskId, turnId, metadata['segmentId']);
  if (actualIndex < 0) throw new Error('Activity log delta has no matching assistant activity.');
  const previous = activitySchema.parse(activities[actualIndex]);
  const mergedText = mergeAssistantText(previous.text, text);
  const updated = activitySchema.parse({ ...previous, text: mergedText, metadata: { ...previous.metadata, ...metadata } });
  const next = [...activities];
  next[actualIndex] = updated;
  return next;
}

function applyAssistantSegmentCompleted(activities: Activity[], taskId: string, segmentId: string, phase: 'progress' | 'final', metadata: Record<string, unknown> = {}): Activity[] {
  const actualIndex = activities.findIndex(activity => activity.taskId === taskId && activity.kind === 'assistant' && activity.metadata['segmentId'] === segmentId);
  if (actualIndex < 0) throw new Error('Activity log segment completion has no matching assistant activity.');
  const previous = activitySchema.parse(activities[actualIndex]);
  const next = [...activities];
  next[actualIndex] = activitySchema.parse({ ...previous, metadata: { ...previous.metadata, ...metadata, assistantPhase: phase } });
  return next;
}

function assistantReplacementId(taskId: string, segmentId: string): string {
  return `assistant-replacement:${taskId}:${segmentId}`;
}

function normalizeActivity(activity: Activity): Activity {
  return activity.kind === 'assistant' ? { ...activity, text: normalizeAssistantText(activity.text) } : activity;
}

function isMissingFile(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as NodeJS.ErrnoException).code === 'ENOENT';
}
