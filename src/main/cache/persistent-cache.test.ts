import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PersistentCache } from './persistent-cache.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
});

describe('PersistentCache', () => {
  it('persists values and reuses them after a new cache instance is created', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'lotagate-cache-'));
    temporaryDirectories.push(directory);
    const first = new PersistentCache(directory);
    await first.set('models:workspace', { models: ['gemini'] }, 60_000);

    const second = new PersistentCache(directory);
    await expect(second.get<{ models: string[] }>('models:workspace')).resolves.toEqual({ models: ['gemini'] });
  });

  it('expires entries and serializes concurrent writes for the same key', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'lotagate-cache-'));
    temporaryDirectories.push(directory);
    const cache = new PersistentCache(directory);
    await Promise.all(Array.from({ length: 20 }, (_, index) => cache.set('same-key', index, 60_000)));
    await expect(cache.get<number>('same-key')).resolves.toBe(19);
    await cache.set('expired', 'value', 1);
    await new Promise(resolve => setTimeout(resolve, 5));
    await expect(cache.get<string>('expired')).resolves.toBeUndefined();
    await expect(readdir(directory)).resolves.toHaveLength(1);
  });
});
