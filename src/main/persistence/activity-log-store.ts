import { mkdir, open, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { z } from 'zod';
import { activitySchema, type Activity } from '../../contracts/ipc/v1/workspace.js';

const ACTIVITY_LOG_VERSION = 1;
const DEFAULT_COMPACTION_BYTES = 1_024 * 1_024;
const DEFAULT_COMPACTION_OPERATIONS = 4_096;

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
  private activitiesCache: Activity[] | undefined;
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
    await this.ensureLoaded();
    return this.activitiesCache!;
  }

  async append(activity: Activity): Promise<void> {
    await this.enqueue(async () => {
      await this.ensureLoaded();
      await this.compactIfNeeded();
      const nextSequence = this.sequence + 1;
      const record: ActivityLogRecord = { version: ACTIVITY_LOG_VERSION, type: 'append', sequence: nextSequence, activity };
      await this.appendRecord(record);
      this.activitiesCache = [...this.activitiesCache!, activity];
      this.sequence = nextSequence;
      this.recordOperation(record);
    });
  }

  async appendAssistantDelta(taskId: string, text: string, metadata: Record<string, unknown>): Promise<Activity | undefined> {
    let updated: Activity | undefined;
    await this.enqueue(async () => {
      await this.ensureLoaded();
      await this.compactIfNeeded();
      const turnId = metadata['turnId'];
      const actualIndex = findAssistantIndex(this.activitiesCache!, taskId, turnId, metadata['segmentId']);
      if (actualIndex < 0) return;
      const previous = activitySchema.parse(this.activitiesCache![actualIndex]);
      updated = activitySchema.parse({ ...previous, text: `${previous.text}${text}`, metadata: { ...previous.metadata, ...metadata } });
      const record: ActivityLogRecord = {
        version: ACTIVITY_LOG_VERSION,
        type: 'assistant.delta',
        sequence: this.sequence + 1,
        taskId,
        ...(turnId === undefined ? {} : { turnId }),
        text,
        metadata,
      };
      await this.appendRecord(record);
      const next = [...this.activitiesCache!];
      next[actualIndex] = updated;
      this.activitiesCache = next;
      this.sequence = record.sequence;
      this.recordOperation(record);
    });
    return updated;
  }

  async completeAssistantSegment(taskId: string, segmentId: string, phase: 'progress' | 'final'): Promise<Activity | undefined> {
    let updated: Activity | undefined;
    await this.enqueue(async () => {
      await this.ensureLoaded();
      await this.compactIfNeeded();
      const actualIndex = this.activitiesCache!.findIndex(activity => activity.taskId === taskId && activity.kind === 'assistant' && activity.metadata['segmentId'] === segmentId);
      if (actualIndex < 0) return;
      const previous = activitySchema.parse(this.activitiesCache![actualIndex]);
      if (previous.metadata['assistantPhase'] === phase) { updated = previous; return; }
      updated = activitySchema.parse({ ...previous, metadata: { ...previous.metadata, assistantPhase: phase } });
      const record: ActivityLogRecord = { version: ACTIVITY_LOG_VERSION, type: 'assistant.segment.completed', sequence: this.sequence + 1, taskId, segmentId, phase };
      await this.appendRecord(record);
      const next = [...this.activitiesCache!];
      next[actualIndex] = updated;
      this.activitiesCache = next;
      this.sequence = record.sequence;
      this.recordOperation(record);
    });
    return updated;
  }

  private async enqueue(operation: () => Promise<void>): Promise<void> {
    const next = this.writeChain.catch(() => undefined).then(operation);
    this.writeChain = next;
    await next;
  }

  private async ensureLoaded(): Promise<void> {
    if (this.activitiesCache !== undefined) return;
    let raw: string;
    try {
      raw = await readFile(this.filePath, 'utf8');
    } catch (error) {
      if (!isMissingFile(error)) throw error;
      await this.importLegacyIfPresent();
      if (this.activitiesCache === undefined) {
        this.activitiesCache = [];
        this.sequence = 0;
      }
      return;
    }
    await this.replay(raw);
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
    const activities = activitySchema.array().parse(JSON.parse(raw));
    this.activitiesCache = activities;
    this.sequence = 0;
    await this.writeSnapshot();
  }

  private async replay(raw: string): Promise<void> {
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
        activities = applyAssistantSegmentCompleted(activities, record.taskId, record.segmentId, record.phase);
        bytesSinceSnapshot += Buffer.byteLength(`${line}\n`, 'utf8');
        operationsSinceSnapshot += 1;
      }
      sequence = record.sequence;
    }
    this.activitiesCache = activitySchema.array().parse(activities);
    this.sequence = Math.max(sequence, 0);
    this.bytesSinceSnapshot = bytesSinceSnapshot;
    this.operationsSinceSnapshot = operationsSinceSnapshot;
  }

  private async repairTrailingRecord(validLines: string[]): Promise<void> {
    const raw = validLines.length === 0 ? '' : `${validLines.join('\n')}\n`;
    const temporary = `${this.filePath}.${process.pid}.repair.tmp`;
    await writeFile(temporary, raw, 'utf8');
    await rename(temporary, this.filePath);
  }

  private async appendRecord(record: ActivityLogRecord): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const handle = await open(this.filePath, 'a');
    try {
      await handle.write(`${JSON.stringify(record)}\n`, null, 'utf8');
      await handle.sync();
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

  private async writeSnapshot(): Promise<void> {
    const record: ActivityLogRecord = { version: ACTIVITY_LOG_VERSION, type: 'snapshot', sequence: this.sequence, activities: this.activitiesCache ?? [] };
    const raw = `${JSON.stringify(record)}\n`;
    await mkdir(dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.${process.pid}.snapshot.tmp`;
    await writeFile(temporary, raw, 'utf8');
    await rename(temporary, this.filePath);
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
  const updated = activitySchema.parse({ ...previous, text: `${previous.text}${text}`, metadata: { ...previous.metadata, ...metadata } });
  const next = [...activities];
  next[actualIndex] = updated;
  return next;
}

function applyAssistantSegmentCompleted(activities: Activity[], taskId: string, segmentId: string, phase: 'progress' | 'final'): Activity[] {
  const actualIndex = activities.findIndex(activity => activity.taskId === taskId && activity.kind === 'assistant' && activity.metadata['segmentId'] === segmentId);
  if (actualIndex < 0) throw new Error('Activity log segment completion has no matching assistant activity.');
  const previous = activitySchema.parse(activities[actualIndex]);
  const next = [...activities];
  next[actualIndex] = activitySchema.parse({ ...previous, metadata: { ...previous.metadata, assistantPhase: phase } });
  return next;
}

function isMissingFile(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as NodeJS.ErrnoException).code === 'ENOENT';
}
