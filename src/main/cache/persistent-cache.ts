import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, unlink, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { desktopDataDirectory, DESKTOP_DATA_DIRECTORIES } from '../persistence/app-data-paths.js';

const DEFAULT_MAX_MEMORY_ENTRIES = 256;

interface CacheEntry<T> {
  version: 1;
  key: string;
  expiresAt: number;
  value: T;
}

export class PersistentCache {
  private readonly memory = new Map<string, CacheEntry<unknown>>();
  private writeChain: Promise<void> = Promise.resolve();

  constructor(private readonly directory = desktopDataDirectory(DESKTOP_DATA_DIRECTORIES.cache), private readonly maxMemoryEntries = DEFAULT_MAX_MEMORY_ENTRIES) {
    if (!Number.isInteger(maxMemoryEntries) || maxMemoryEntries < 1) throw new Error('Cache memory capacity must be a positive integer.');
    void this.enqueue(() => this.sweepExpiredEntries()).catch(() => undefined);
  }

  async get<T>(key: string): Promise<T | undefined> {
    const cached = this.memory.get(key) ?? await this.readEntry(key);
    if (cached === undefined) return undefined;
    if (cached.expiresAt <= Date.now()) {
      this.memory.delete(key);
      await this.enqueue(() => this.removeEntry(key));
      return undefined;
    }
    this.remember(key, cached);
    return cached.value as T;
  }

  async set<T>(key: string, value: T, ttlMs: number): Promise<void> {
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) throw new Error('Cache TTL must be a positive finite number.');
    const entry: CacheEntry<T> = { version: 1, key, expiresAt: Date.now() + ttlMs, value };
    this.remember(key, entry);
    await this.enqueue(async () => {
      await mkdir(this.directory, { recursive: true });
      const path = this.pathFor(key);
      const temporary = `${path}.${process.pid}.tmp`;
      await writeFile(temporary, JSON.stringify(entry), 'utf8');
      await rename(temporary, path);
    });
  }

  async delete(key: string): Promise<void> {
    this.memory.delete(key);
    await this.enqueue(() => this.removeEntry(key));
  }

  async clear(): Promise<void> {
    this.memory.clear();
    await this.enqueue(async () => {
      const files = await readdir(this.directory, { withFileTypes: true }).catch(() => []);
      await Promise.all(files.filter(file => file.isFile() && file.name.endsWith('.json')).map(file => unlink(join(this.directory, file.name)).catch(() => undefined)));
    });
  }

  private async readEntry(key: string): Promise<CacheEntry<unknown> | undefined> {
    try {
      const value: unknown = JSON.parse(await readFile(this.pathFor(key), 'utf8'));
      if (!isCacheEntry(value, key)) return undefined;
      return value;
    } catch {
      return undefined;
    }
  }

  private async removeEntry(key: string): Promise<void> {
    await unlink(this.pathFor(key)).catch(() => undefined);
  }

  private remember(key: string, entry: CacheEntry<unknown>): void {
    this.memory.delete(key);
    this.memory.set(key, entry);
    while (this.memory.size > this.maxMemoryEntries) {
      const oldest = this.memory.keys().next().value;
      if (typeof oldest !== 'string') break;
      this.memory.delete(oldest);
    }
  }

  private async sweepExpiredEntries(): Promise<void> {
    const now = Date.now();
    const files = await readdir(this.directory, { withFileTypes: true }).catch(() => []);
    await Promise.all(files.filter(file => file.isFile() && file.name.endsWith('.json')).map(async file => {
      const path = join(this.directory, file.name);
      try {
        const value: unknown = JSON.parse(await readFile(path, 'utf8'));
        const key = value && typeof value === 'object' && 'key' in value && typeof (value as { key?: unknown }).key === 'string' ? (value as { key: string }).key : undefined;
        if (key === undefined || !isCacheEntry(value, key)) return;
        if (value.expiresAt <= now) await unlink(path).catch(() => undefined);
      } catch { await unlink(path).catch(() => undefined); }
    }));
  }

  private async enqueue(operation: () => Promise<void>): Promise<void> {
    const next = this.writeChain.catch(() => undefined).then(operation);
    this.writeChain = next;
    await next;
  }

  private pathFor(key: string): string {
    const digest = createHash('sha256').update(key, 'utf8').digest('hex');
    return join(this.directory, `${digest}.json`);
  }
}

function isCacheEntry(value: unknown, key: string): value is CacheEntry<unknown> {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return record['version'] === 1 && record['key'] === key && typeof record['expiresAt'] === 'number' && Number.isFinite(record['expiresAt']) && 'value' in record;
}
