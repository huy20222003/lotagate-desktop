import { mkdtemp, readFile, readlink, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { DesktopEvent, DesktopHostRequest, DesktopHostResponse } from '../../contracts/agent-protocol/v1/desktop.js';
import { checkpointWorkspaceDirectory } from './checkpoint-paths.js';
import { CheckpointService } from './checkpoint-service.js';
import { CheckpointStore } from './checkpoint-store.js';

const roots: string[] = [];
const originalHome = process.env['LOTAGATE_HOME'];

describe('CheckpointService', () => {
  afterEach(async () => { if (originalHome === undefined) delete process.env['LOTAGATE_HOME']; else process.env['LOTAGATE_HOME'] = originalHome; await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

  it('captures created, modified, deleted, and renamed files and undoes them in reverse order', async () => {
    const root = await workspace();
    process.env['LOTAGATE_HOME'] = root;
    await writeFile(join(root, 'modified.txt'), 'before');
    await writeFile(join(root, 'deleted.txt'), 'remove me');
    await writeFile(join(root, 'renamed.txt'), 'move me');
    const service = new CheckpointService();
    await service.observeEvent(root, event('turn.started', { taskId: 'task-1', sessionId: 'session-1', turnId: 'turn-1' }));
    await execute(service, root, request('filesystem', 'filesystem.write', { path: 'created.txt', content: 'created' }, 'session-1'));
    await execute(service, root, request('filesystem', 'filesystem.write', { path: 'modified.txt', content: 'after' }, 'session-1'));
    await execute(service, root, request('shell', 'shell.exec', {}, 'session-1'), async () => { await rm(join(root, 'deleted.txt')); await rename(join(root, 'renamed.txt'), join(root, 'moved.txt')); return response(); });
    await service.observeEvent(root, event('turn.completed', { sessionId: 'session-1', turnId: 'turn-1' }));

    const statuses = await service.list(root, 'task-1');
    expect(statuses[0]).toMatchObject({ turnId: 'turn-1', state: 'ready', fileCount: 5 });
    const result = await service.undo(root, 'task-1', 'turn-1');
    expect(result).toMatchObject({ state: 'undone', conflicts: [] });
    await expect(readFile(join(root, 'modified.txt'), 'utf8')).resolves.toBe('before');
    await expect(readFile(join(root, 'deleted.txt'), 'utf8')).resolves.toBe('remove me');
    await expect(readFile(join(root, 'renamed.txt'), 'utf8')).resolves.toBe('move me');
    await expect(readFile(join(root, 'created.txt'), 'utf8')).rejects.toThrow();
    await expect(readFile(join(root, 'moved.txt'), 'utf8')).rejects.toThrow();
    await expect((await service.list(root, 'task-1'))[0]).toMatchObject({ state: 'undone' });
  });

  it('refuses to overwrite a file changed after the turn and records a conflict', async () => {
    const root = await workspace();
    process.env['LOTAGATE_HOME'] = root;
    await writeFile(join(root, 'note.txt'), 'agent version');
    const service = new CheckpointService();
    await service.observeEvent(root, event('turn.started', { taskId: 'task-2', sessionId: 'session-2', turnId: 'turn-2' }));
    await execute(service, root, request('filesystem', 'filesystem.write', { path: 'note.txt', content: 'new agent version' }, 'session-2'));
    await service.observeEvent(root, event('turn.completed', { sessionId: 'session-2', turnId: 'turn-2' }));
    await writeFile(join(root, 'note.txt'), 'user version');

    const result = await service.undo(root, 'task-2', 'turn-2');
    expect(result).toMatchObject({ state: 'conflict', conflicts: ['note.txt'] });
    await expect(readFile(join(root, 'note.txt'), 'utf8')).resolves.toBe('user version');
  });

  it('stores worktree mutations under the project root so Undo targets auto-applied files', async () => {
    const root = await workspace();
    const executionCwd = await workspace();
    process.env['LOTAGATE_HOME'] = root;
    await writeFile(join(root, 'note.txt'), 'before');
    await writeFile(join(executionCwd, 'note.txt'), 'before');
    const service = new CheckpointService();
    await service.observeEvent(root, event('turn.started', { taskId: 'task-worktree', sessionId: 'session-worktree', turnId: 'turn-worktree' }));
    await execute(service, root, request('filesystem', 'filesystem.write', { path: 'note.txt', content: 'after' }, 'session-worktree', executionCwd), async () => {
      await writeFile(join(executionCwd, 'note.txt'), 'after');
      return response();
    });
    await service.observeEvent(root, event('turn.completed', { sessionId: 'session-worktree', turnId: 'turn-worktree' }));
    await writeFile(join(root, 'note.txt'), 'after');

    await expect(service.list(root, 'task-worktree')).resolves.toEqual([expect.objectContaining({ turnId: 'turn-worktree', state: 'ready' })]);
    await expect(service.undo(root, 'task-worktree', 'turn-worktree')).resolves.toMatchObject({ state: 'undone', conflicts: [] });
    await expect(readFile(join(root, 'note.txt'), 'utf8')).resolves.toBe('before');
  });

  it('restores the complete pre-undo state if restoring a later mutation fails', async () => {
    const root = await workspace();
    process.env['LOTAGATE_HOME'] = root;
    await writeFile(join(root, 'first.txt'), 'first-before');
    await writeFile(join(root, 'second.txt'), 'second-before');
    const service = new CheckpointService();
    await service.observeEvent(root, event('turn.started', { taskId: 'task-3', sessionId: 'session-3', turnId: 'turn-3' }));
    await execute(service, root, request('filesystem', 'filesystem.write', { path: 'first.txt', content: 'first-after' }, 'session-3'));
    await execute(service, root, request('filesystem', 'filesystem.write', { path: 'second.txt', content: 'second-after' }, 'session-3'));
    await service.observeEvent(root, event('turn.completed', { sessionId: 'session-3', turnId: 'turn-3' }));
    const journal = JSON.parse((await readFile(join(checkpointWorkspaceDirectory(root), 'checkpoints.jsonl'), 'utf8')).trim().split(/\r?\n/u).at(-1) as string) as { mutations: Array<{ before?: { objectHash: string } }> };
    const objectHash = journal.mutations[0]?.before?.objectHash;
    if (!objectHash) throw new Error('Test checkpoint did not contain the expected object.');
    await rm(join(checkpointWorkspaceDirectory(root), 'objects', objectHash));

    const result = await service.undo(root, 'task-3', 'turn-3');
    expect(result.state).toBe('failed');
    await expect(readFile(join(root, 'first.txt'), 'utf8')).resolves.toBe('first-after');
    await expect(readFile(join(root, 'second.txt'), 'utf8')).resolves.toBe('second-after');
  });

  it('compacts the journal and garbage-collects checkpoints beyond retention', async () => {
    const root = await workspace();
    process.env['LOTAGATE_HOME'] = root;
    const store = new CheckpointStore(root);
    for (let index = 0; index < 101; index += 1) {
      const value = Buffer.from(`checkpoint-${index}`);
      const object = await store.objects.put('file', value);
      await store.append({ id: `checkpoint-${index}`, type: 'turn', workspaceRoot: root, taskId: 'task-gc', turnId: `turn-${index}`, createdAt: new Date(Date.now() + index).toISOString(), state: 'ready', mutations: [{ sequence: 0, kind: 'created', path: `file-${index}.txt`, after: { kind: 'file', hash: object.hash, objectHash: object.hash, size: value.byteLength } }] });
    }
    await store.gc();
    expect((await store.records()).length).toBe(100);
  });

  it('reverses repeated writes to the same path', async () => {
    const root = await workspace();
    process.env['LOTAGATE_HOME'] = root;
    await writeFile(join(root, 'repeat.txt'), 'original');
    const service = new CheckpointService();
    await service.observeEvent(root, event('turn.started', { taskId: 'task-4', sessionId: 'session-4', turnId: 'turn-4' }));
    await execute(service, root, request('filesystem', 'filesystem.write', { path: 'repeat.txt', content: 'first' }, 'session-4'));
    await execute(service, root, request('filesystem', 'filesystem.write', { path: 'repeat.txt', content: 'second' }, 'session-4'));
    await service.observeEvent(root, event('turn.completed', { sessionId: 'session-4', turnId: 'turn-4' }));

    const result = await service.undo(root, 'task-4', 'turn-4');
    expect(result.state).toBe('undone');
    await expect(readFile(join(root, 'repeat.txt'), 'utf8')).resolves.toBe('original');
  });

  it.skipIf(process.platform === 'win32')('restores symlink entries', async () => {
    const root = await workspace();
    process.env['LOTAGATE_HOME'] = root;
    await symlink('target-a', join(root, 'link.txt'));
    const service = new CheckpointService();
    await service.observeEvent(root, event('turn.started', { taskId: 'task-6', sessionId: 'session-6', turnId: 'turn-6' }));
    await execute(service, root, request('shell', 'shell.exec', {}, 'session-6'), async () => { await rm(join(root, 'link.txt')); await symlink('target-b', join(root, 'link.txt')); return response(); });
    await service.observeEvent(root, event('turn.completed', { sessionId: 'session-6', turnId: 'turn-6' }));
    expect((await service.undo(root, 'task-6', 'turn-6')).state).toBe('undone');
    await expect(readlink(join(root, 'link.txt'))).resolves.toBe('target-a');
  });

  it('does not create an undo entry for a mutation request that changes nothing', async () => {
    const root = await workspace();
    process.env['LOTAGATE_HOME'] = root;
    const service = new CheckpointService();
    await service.observeEvent(root, event('turn.started', { taskId: 'task-5', sessionId: 'session-5', turnId: 'turn-5' }));
    await execute(service, root, request('shell', 'shell.exec', {}, 'session-5'), async () => response());
    await service.observeEvent(root, event('turn.completed', { sessionId: 'session-5', turnId: 'turn-5' }));
    await expect(service.list(root, 'task-5')).resolves.toEqual([]);
  });
});

async function workspace(): Promise<string> { const root = await mkdtemp(join(process.env['TEMP'] ?? '.', 'lotagate-checkpoint-')); roots.push(root); return root; }
function event(name: string, data: Record<string, unknown>): DesktopEvent { return { version: 2, type: 'event', event: name, data }; }
function request(tool: DesktopHostRequest['tool'], action: string, params: Record<string, unknown>, sessionId: string, executionCwd?: string): DesktopHostRequest { return { version: 2, type: 'host.request', requestId: `${tool}-${action}-${sessionId}`, tool, sessionId, runId: 'run-1', action, params, executionBoundary: 'host', hostFallback: 'deny', ...(executionCwd === undefined ? {} : { executionCwd }) }; }
async function execute(service: CheckpointService, root: string, input: DesktopHostRequest, operation?: () => Promise<DesktopHostResponse>): Promise<void> { await service.withHostRequest(root, input, operation ?? (async () => { const path = input.params['path'] as string; await writeFile(join(root, path), input.params['content'] as string); return response(); })); }
function response(): DesktopHostResponse { return { version: 2, type: 'host.response', requestId: 'request', tool: 'filesystem', executionBoundary: 'host', ok: true, result: true }; }
