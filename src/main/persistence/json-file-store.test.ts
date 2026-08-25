import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { JsonFileStore } from './json-file-store.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
});

describe('JsonFileStore', () => {
  it('serializes concurrent read-modify-write updates', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'lotagate-store-'));
    temporaryDirectories.push(directory);
    const path = join(directory, 'state.json');
    const store = new JsonFileStore<number[]>(path, []);
    await Promise.all(Array.from({ length: 25 }, () => store.update(current => [...current, current.length])));
    const value = await store.read();
    expect(value).toHaveLength(25);
    expect(JSON.parse(await readFile(path, 'utf8'))).toHaveLength(25);
  });

  it('validates persisted values at the storage boundary', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'lotagate-store-'));
    temporaryDirectories.push(directory);
    const path = join(directory, 'state.json');
    const store = new JsonFileStore<number[]>(path, [], value => z.array(z.number()).parse(value));
    await store.write([1, 2, 3]);
    await import('node:fs/promises').then(({ writeFile }) => writeFile(path, JSON.stringify(['invalid']), 'utf8'));
    await expect(store.read()).rejects.toThrow();
  });
});
