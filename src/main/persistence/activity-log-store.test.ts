import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Activity } from '../../contracts/ipc/v1/workspace.js';
import { ActivityLogStore } from './activity-log-store.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
});

describe('ActivityLogStore', () => {
  it('persists assistant deltas as journal records and rebuilds them after reload', async () => {
    const directory = await createTemporaryDirectory();
    const path = join(directory, 'activities.jsonl');
    const store = new ActivityLogStore(path);
    await store.append(activity('assistant-1', 'seed'));

    await store.appendAssistantDelta('task-1', ' hello', { turnId: 'turn-1', sequence: 1 });
    await store.appendAssistantDelta('task-1', ' world', { turnId: 'turn-1', sequence: 2 });

    expect((await store.read())[0]?.text).toBe('seed hello world');
    const records = (await readFile(path, 'utf8')).trim().split('\n').map(line => JSON.parse(line) as { type: string });
    expect(records.map(record => record.type)).toEqual(['append', 'assistant.delta', 'assistant.delta']);

    const reloaded = new ActivityLogStore(path);
    expect((await reloaded.read())[0]?.text).toBe('seed hello world');
  });

  it('writes a batch of assistant deltas with one journal flush while retaining every record', async () => {
    const directory = await createTemporaryDirectory();
    const path = join(directory, 'activities.jsonl');
    const store = new ActivityLogStore(path);
    await store.append(activity('assistant-1', 'seed'));

    await store.appendAssistantDeltas('task-1', [
      { text: ' hello', metadata: { turnId: 'turn-1', sequence: 1 } },
      { text: ' world', metadata: { turnId: 'turn-1', sequence: 2 } },
    ]);

    expect((await store.read())[0]?.text).toBe('seed hello world');
    const records = (await readFile(path, 'utf8')).trim().split('\n').map(line => JSON.parse(line) as { type: string });
    expect(records.map(record => record.type)).toEqual(['append', 'assistant.delta', 'assistant.delta']);
    const reloaded = new ActivityLogStore(path);
    expect((await reloaded.read())[0]?.text).toBe('seed hello world');
  });

  it('persists and replays assistant segment completion metadata', async () => {
    const directory = await createTemporaryDirectory();
    const path = join(directory, 'activities.jsonl');
    const store = new ActivityLogStore(path);
    await store.append({ ...activity('assistant-1', 'Final'), metadata: { turnId: 'turn-1', segmentId: 'run-1:1', assistantPhase: 'progress' } });

    await store.completeAssistantSegment('task-1', 'run-1:1', 'final');

    expect((await store.read())[0]?.metadata['assistantPhase']).toBe('final');
    const reloaded = new ActivityLogStore(path);
    expect((await reloaded.read())[0]?.metadata['assistantPhase']).toBe('final');
  });

  it('serializes concurrent appends without losing records', async () => {
    const directory = await createTemporaryDirectory();
    const store = new ActivityLogStore(join(directory, 'activities.jsonl'));
    await Promise.all(Array.from({ length: 25 }, (_, index) => store.append(activity(`activity-${index}`, `${index}`))));

    const activities = await store.read();
    expect(activities).toHaveLength(25);
    expect(new Set(activities.map(item => item.id)).size).toBe(25);
  });

  it('returns a task page without returning unrelated activities', async () => {
    const directory = await createTemporaryDirectory();
    const store = new ActivityLogStore(join(directory, 'activities.jsonl'));
    await store.append(activity('task-1-a', 'one'));
    await store.append({ ...activity('task-2-a', 'other'), taskId: 'task-2' });
    await store.append(activity('task-1-b', 'two'));

    await expect(store.readPage('task-1', { limit: 1 })).resolves.toEqual({ activities: [expect.objectContaining({ id: 'task-1-b' })], nextCursor: 'task-1-b', hasMore: true });
  });

  it('imports the existing JSON array once and continues with the journal format', async () => {
    const directory = await createTemporaryDirectory();
    const legacyPath = join(directory, 'activities.json');
    const journalPath = join(directory, 'activities.jsonl');
    await writeFile(legacyPath, JSON.stringify([activity('legacy-1', 'legacy')]), 'utf8');
    const store = new ActivityLogStore(journalPath, legacyPath);

    expect(await store.read()).toHaveLength(1);
    expect((await readFile(journalPath, 'utf8')).trim().startsWith('{"version":1,"type":"snapshot"')).toBe(true);
    await store.append(activity('new-1', 'new'));
    expect((await store.read()).map(item => item.id)).toEqual(['legacy-1', 'new-1']);
  });

  it('compacts accumulated operations into an atomic snapshot at the configured threshold', async () => {
    const directory = await createTemporaryDirectory();
    const path = join(directory, 'activities.jsonl');
    const store = new ActivityLogStore(path, undefined, { compactionOperations: 1, compactionBytes: Number.MAX_SAFE_INTEGER });
    await store.append(activity('assistant-1', 'seed'));
    await store.appendAssistantDelta('task-1', ' delta', { turnId: 'turn-1' });

    const records = (await readFile(path, 'utf8')).trim().split('\n').map(line => JSON.parse(line) as { type: string });
    expect(records.map(record => record.type)).toEqual(['snapshot', 'assistant.delta']);
    expect((await store.read())[0]?.text).toBe('seed delta');
  });

  it('repairs an incomplete trailing journal record before continuing', async () => {
    const directory = await createTemporaryDirectory();
    const path = join(directory, 'activities.jsonl');
    const store = new ActivityLogStore(path);
    await store.append(activity('assistant-1', 'seed'));
    const incompleteRecord = JSON.stringify({ version: 1, type: 'assistant.delta' }).slice(0, 20);
    await writeFile(path, `${await readFile(path, 'utf8')}${incompleteRecord}`, 'utf8');

    const reloaded = new ActivityLogStore(path);
    expect((await reloaded.read())[0]?.text).toBe('seed');
    await reloaded.appendAssistantDelta('task-1', ' delta', { turnId: 'turn-1' });
    expect((await reloaded.read())[0]?.text).toBe('seed delta');
  });
});

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'lotagate-activity-log-'));
  temporaryDirectories.push(directory);
  return directory;
}

function activity(id: string, text: string): Activity {
  return { id, taskId: 'task-1', kind: 'assistant', text, metadata: { turnId: 'turn-1' }, createdAt: '2026-01-01T00:00:00.000Z' };
}
