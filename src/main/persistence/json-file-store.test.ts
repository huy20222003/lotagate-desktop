import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
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
});
