import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { checkpointWorkspaceDirectory } from './checkpoint-paths.js';
import { CheckpointObjectStore } from './checkpoint-object-store.js';
import type { CheckpointRecord } from './checkpoint-types.js';
import { MAX_CHECKPOINT_AGE_MS, MAX_CHECKPOINTS, MAX_OBJECT_BYTES } from './checkpoint-constants.js';

export class CheckpointStore {
  readonly directory: string;
  readonly objects: CheckpointObjectStore;
  private readonly journal: string;
  private readonly metadata: string;

  constructor(workspaceRoot: string) {
    this.directory = checkpointWorkspaceDirectory(workspaceRoot);
    this.objects = new CheckpointObjectStore(join(this.directory, 'objects'));
    this.journal = join(this.directory, 'checkpoints.jsonl');
    this.metadata = join(this.directory, 'metadata.json');
  }

  async append(record: CheckpointRecord): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    await appendFile(this.journal, `${JSON.stringify(record)}\n`, 'utf8');
  }

  async records(): Promise<CheckpointRecord[]> {
    let content: string;
    try { content = await readFile(this.journal, 'utf8'); } catch { return []; }
    const latest = new Map<string, CheckpointRecord>();
    for (const line of content.split(/\r?\n/u)) {
      if (!line.trim()) continue;
      try {
        const value: unknown = JSON.parse(line);
        if (isRecord(value)) latest.set(value.id, value);
      } catch { /* Ignore a partial final journal line after an interrupted write. */ }
    }
    return [...latest.values()].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  async compact(): Promise<void> {
    const records = await this.records();
    await mkdir(this.directory, { recursive: true });
    const temporary = `${this.journal}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporary, records.map(record => JSON.stringify(record)).join('\n') + (records.length ? '\n' : ''), 'utf8');
    await rename(temporary, this.journal);
    await writeFile(this.metadata, JSON.stringify({ updatedAt: new Date().toISOString(), checkpointCount: records.length }, null, 2), 'utf8');
  }

  async gc(now = Date.now()): Promise<void> {
    const records = await this.records();
    const active = records.filter(record => record.state === 'active' || record.state === 'recovery');
    const candidates = records.filter(record => record.type === 'turn' && record.state !== 'active' && record.state !== 'recovery')
      .filter(record => now - Date.parse(record.createdAt) <= MAX_CHECKPOINT_AGE_MS)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, MAX_CHECKPOINTS);
    const objectSizes = await this.objects.sizes();
    const retained = [...active];
    const referencedByRetained = new Set(active.flatMap(record => objectHashes(record)));
    let retainedBytes = [...referencedByRetained].reduce((total, hash) => total + (objectSizes.get(hash) ?? 0), 0);
    for (const candidate of candidates) {
      const hashes = objectHashes(candidate).filter(hash => !referencedByRetained.has(hash));
      const candidateBytes = hashes.reduce((total, hash) => total + (objectSizes.get(hash) ?? 0), 0);
      if (retained.length >= MAX_CHECKPOINTS + active.length || retainedBytes + candidateBytes > MAX_OBJECT_BYTES && retained.length > active.length) continue;
      retained.push(candidate);
      hashes.forEach(hash => referencedByRetained.add(hash));
      retainedBytes += candidateBytes;
    }
    await this.objects.removeUnreferenced(referencedByRetained);
    await this.writeRecords(retained);
  }

  private async writeRecords(records: CheckpointRecord[]): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    const temporary = `${this.journal}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporary, records.sort((left, right) => left.createdAt.localeCompare(right.createdAt)).map(record => JSON.stringify(record)).join('\n') + (records.length ? '\n' : ''), 'utf8');
    await rename(temporary, this.journal);
    await writeFile(this.metadata, JSON.stringify({ updatedAt: new Date().toISOString(), checkpointCount: records.length }, null, 2), 'utf8');
  }
}

function objectHashes(record: CheckpointRecord): string[] { return record.mutations.flatMap(mutation => [mutation.before?.objectHash, mutation.after?.objectHash]).filter((hash): hash is string => hash !== undefined); }

function isRecord(value: unknown): value is CheckpointRecord {
  if (typeof value !== 'object' || value === null) return false;
  const item = value as Record<string, unknown>;
  return typeof item['id'] === 'string' && (item['type'] === 'turn' || item['type'] === 'recovery') && typeof item['workspaceRoot'] === 'string' && typeof item['taskId'] === 'string' && typeof item['turnId'] === 'string' && typeof item['createdAt'] === 'string' && typeof item['state'] === 'string' && Array.isArray(item['mutations']);
}
