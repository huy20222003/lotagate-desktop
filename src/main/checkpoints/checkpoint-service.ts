import { randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, readlink, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type { DesktopHostRequest, DesktopHostResponse, DesktopEvent } from '../../contracts/agent-protocol/v1/desktop.js';
import type { CheckpointStatus, CheckpointUndoResult } from '../../contracts/ipc/v1/workspace.js';
import { requireWorkspaceMutationPath } from '../security/path-policy.js';
import { CheckpointStore } from './checkpoint-store.js';
import { scanWorkspace } from './checkpoint-scanner.js';
import { hashObject } from './checkpoint-object-store.js';
import type { CheckpointEntry, CheckpointMutation, CheckpointRecord, WorkspaceEntry } from './checkpoint-types.js';

interface ActiveTurn { taskId: string; sessionId: string; turnId: string; record: CheckpointRecord; }
interface CheckpointServiceOptions { onError?: (error: unknown, cwd: string) => void; }

export class CheckpointService {
  private readonly active = new Map<string, ActiveTurn>();
  private readonly stores = new Map<string, CheckpointStore>();
  private readonly queues = new Map<string, Promise<void>>();

  constructor(private readonly options: CheckpointServiceOptions = {}) {}

  observeEvent(cwd: string, event: DesktopEvent): Promise<void> {
    return this.enqueue(cwd, async () => {
      const data = event.data;
      const sessionId = stringValue(data['sessionId']);
      const turnId = stringValue(data['turnId']);
      if (sessionId === undefined || turnId === undefined) return;
      const key = this.key(cwd, sessionId);
      if (event.event === 'turn.started') {
        const taskId = stringValue(data['taskId']);
        if (taskId === undefined) return;
        const record: CheckpointRecord = { id: randomUUID(), type: 'turn', workspaceRoot: resolve(cwd), taskId, sessionId, turnId, createdAt: new Date().toISOString(), state: 'active', mutations: [] };
        this.active.set(key, { taskId, sessionId, turnId, record });
        return;
      }
      if (!['turn.completed', 'turn.failed', 'turn.cancelled'].includes(event.event)) return;
      const current = this.active.get(key);
      if (current === undefined || current.turnId !== turnId) return;
      if (current.record.mutations.length > 0) {
        current.record.state = 'ready';
        await this.store(cwd).append(current.record);
        await this.store(cwd).compact();
      }
      this.active.delete(key);
      await this.store(cwd).gc();
    });
  }

  async withHostRequest(cwd: string, request: DesktopHostRequest, operation: () => Promise<DesktopHostResponse>): Promise<DesktopHostResponse> {
    if (!isMutationRequest(request)) return operation();
    return this.enqueueResult(cwd, async () => {
      const active = this.findActive(cwd, request.sessionId);
      if (active === undefined) return operation();
      const executionCwd = request.executionCwd ?? cwd;
      let before: Map<string, WorkspaceEntry>;
      try { before = await scanWorkspace(executionCwd); } catch (error) { this.options.onError?.(error, executionCwd); return operation(); }
      let response: DesktopHostResponse;
      try { response = await operation(); }
      finally {
        try {
          const after = await scanWorkspace(executionCwd);
          const mutations = await buildMutations(before, after, this.store(cwd), active.record.mutations.length);
          if (mutations.length > 0) {
            active.record.mutations.push(...mutations);
            await this.store(cwd).append(active.record);
          }
        } catch (error) { this.options.onError?.(error, executionCwd); }
      }
      return response;
    });
  }

  async list(cwd: string, taskId: string): Promise<CheckpointStatus[]> {
    const records = await this.store(cwd).records();
    return records.filter(record => record.type === 'turn' && record.taskId === taskId).flatMap(record => { const state = undoState(record.state); return state === undefined ? [] : [{ checkpointId: record.id, taskId: record.taskId, turnId: record.turnId, state, fileCount: changedPathCount(record.mutations), createdAt: record.createdAt }]; });
  }

  async undo(cwd: string, taskId: string, turnId: string): Promise<CheckpointUndoResult> {
    return this.enqueueResult(cwd, async () => {
      const store = this.store(cwd);
      const record = (await store.records()).find(item => item.type === 'turn' && item.taskId === taskId && item.turnId === turnId);
      if (record === undefined) throw new Error('No undo checkpoint exists for this turn.');
      if (record.state !== 'ready') return { checkpointId: record.id, state: record.state === 'conflict' ? 'conflict' : record.state === 'undone' ? 'undone' : 'failed', revertedPaths: [], conflicts: [], ...(record.state === 'failed' ? { error: 'This checkpoint is not available for undo.' } : {}) };
      const paths = uniqueMutationPaths(record.mutations);
      const current = new Map<string, WorkspaceEntry | undefined>();
      const conflicts: string[] = [];
      for (const path of paths) current.set(path, await readWorkspaceEntry(cwd, path));
      const expected = new Map<string, CheckpointEntry | undefined>();
      for (const mutation of record.mutations) { expected.set(mutation.path, mutation.after); if (mutation.fromPath !== undefined) expected.set(mutation.fromPath, undefined); }
      for (const path of paths) if (!matches(current.get(path), expected.get(path))) conflicts.push(path);
      if (conflicts.length > 0) {
        record.state = 'conflict';
        await store.append(record);
        return { checkpointId: record.id, state: 'conflict', revertedPaths: [], conflicts: [...new Set(conflicts)] };
      }
      const recoveryId = randomUUID();
      const recovery = await this.createRecovery(cwd, record, recoveryId, current);
      try {
        const revertedPaths: string[] = [];
        for (const mutation of [...record.mutations].reverse()) {
          await verifyCurrentBeforeRestore(cwd, mutation);
          await restoreMutation(cwd, store, mutation);
          revertedPaths.push(mutation.path, ...(mutation.fromPath === undefined ? [] : [mutation.fromPath]));
        }
        record.state = 'undone';
        await store.append(record);
        recovery.state = 'undone';
        await store.append(recovery);
        await store.compact();
        await store.gc();
        return { checkpointId: record.id, state: 'undone', revertedPaths: [...new Set(revertedPaths)], conflicts: [] };
      } catch (error) {
        await restoreRecovery(cwd, current).catch(recoveryError => this.options.onError?.(recoveryError, cwd));
        record.state = 'failed';
        await store.append(record);
        recovery.state = 'failed';
        await store.append(recovery);
        return { checkpointId: record.id, state: 'failed', revertedPaths: [], conflicts: [], error: error instanceof Error ? error.message : 'Undo failed and the original workspace state was restored.' };
      }
    });
  }

  private async createRecovery(cwd: string, source: CheckpointRecord, id: string, current: Map<string, WorkspaceEntry | undefined>): Promise<CheckpointRecord> {
    const mutations: CheckpointMutation[] = [];
    let sequence = 0;
    for (const [path, entry] of current) {
      const after = entry === undefined ? undefined : await entryFromWorkspace(this.store(cwd), entry);
      mutations.push(after === undefined ? { sequence: sequence++, kind: 'deleted', path } : { sequence: sequence++, kind: 'created', path, after });
    }
    const recovery: CheckpointRecord = { id, type: 'recovery', workspaceRoot: resolve(cwd), taskId: source.taskId, turnId: source.turnId, createdAt: new Date().toISOString(), state: 'recovery', mutations, sourceCheckpointId: source.id };
    await this.store(cwd).append(recovery);
    return recovery;
  }

  private findActive(cwd: string, sessionId: string): ActiveTurn | undefined { return this.active.get(this.key(cwd, sessionId)); }
  private store(cwd: string): CheckpointStore { const root = resolve(cwd); const current = this.stores.get(root) ?? new CheckpointStore(root); this.stores.set(root, current); return current; }
  private key(cwd: string, sessionId: string): string { return `${resolve(cwd)}\0${sessionId}`; }
  private async enqueue(cwd: string, operation: () => Promise<void>): Promise<void> { await this.enqueueResult(cwd, async () => { await operation(); return undefined; }); }
  private async enqueueResult<T>(cwd: string, operation: () => Promise<T>): Promise<T> { const key = resolve(cwd); const previous = this.queues.get(key) ?? Promise.resolve(); const next = previous.catch(() => undefined).then(operation); const queued = next.then(() => undefined, () => undefined); this.queues.set(key, queued); try { return await next; } finally { if (this.queues.get(key) === queued) this.queues.delete(key); } }
}

function isMutationRequest(request: DesktopHostRequest): boolean {
  if (request.tool === 'filesystem' && request.action === 'filesystem.write' || request.tool === 'shell' || request.tool === 'git') return true;
  if (request.tool !== 'document') return false;
  return !DOCUMENT_READ_ACTIONS.has(request.action.split('.', 2)[1] ?? '');
}
const DOCUMENT_READ_ACTIONS = new Set(['open', 'inspect', 'validate', 'readText', 'extractTables', 'readForm', 'readSlide', 'readRange', 'readContent']);
async function buildMutations(before: Map<string, WorkspaceEntry>, after: Map<string, WorkspaceEntry>, store: CheckpointStore, sequenceStart: number): Promise<CheckpointMutation[]> {
  const removed = [...before.keys()].filter(path => !after.has(path));
  const added = [...after.keys()].filter(path => !before.has(path));
  const paired = new Set<string>();
  const pairedSources = new Set<string>();
  const mutations: CheckpointMutation[] = [];
  let sequence = sequenceStart;
  for (const fromPath of removed) {
    const beforeEntry = before.get(fromPath);
    const target = added.find(path => !paired.has(path) && sameWorkspaceEntry(beforeEntry, after.get(path)));
    if (target === undefined || beforeEntry === undefined) continue;
    paired.add(target);
    pairedSources.add(fromPath);
    mutations.push({ sequence: sequence++, kind: 'renamed', path: target, fromPath, before: await entryFromWorkspace(store, beforeEntry), after: await entryFromWorkspace(store, after.get(target) as WorkspaceEntry) });
  }
  for (const path of new Set([...before.keys(), ...after.keys()])) {
    const left = before.get(path); const right = after.get(path);
    if (left !== undefined && right !== undefined) {
      if (!sameWorkspaceEntry(left, right)) mutations.push({ sequence: sequence++, kind: 'modified', path, before: await entryFromWorkspace(store, left), after: await entryFromWorkspace(store, right) });
    } else if (left !== undefined && !pairedSources.has(path)) mutations.push({ sequence: sequence++, kind: 'deleted', path, before: await entryFromWorkspace(store, left) });
    else if (right !== undefined && !paired.has(path)) mutations.push({ sequence: sequence++, kind: 'created', path, after: await entryFromWorkspace(store, right) });
  }
  return mutations;
}

async function entryFromWorkspace(store: CheckpointStore, value: WorkspaceEntry): Promise<CheckpointEntry> { const object = await store.objects.put(value.kind, value.bytes); const hash = hashObject(value.kind, value.bytes); return { kind: value.kind, hash, objectHash: object.hash, size: value.bytes.byteLength }; }
async function readWorkspaceEntry(root: string, path: string): Promise<WorkspaceEntry | undefined> {
  const target = await requireWorkspaceMutationPath(join(resolve(root), path), root);
  try {
    const details = await lstat(target);
    if (details.isSymbolicLink()) return { kind: 'symlink', bytes: Buffer.from(await readlink(target), 'utf8') };
    if (details.isFile()) return { kind: 'file', bytes: await readFile(target) };
    return undefined;
  } catch { return undefined; }
}
async function restoreMutation(root: string, store: CheckpointStore, mutation: CheckpointMutation): Promise<void> {
  if (mutation.fromPath !== undefined) {
    await writeWorkspaceEntry(root, store, mutation.path, undefined);
    await writeWorkspaceEntry(root, store, mutation.fromPath, mutation.before);
    return;
  }
  await writeWorkspaceEntry(root, store, mutation.path, mutation.before);
}
async function writeWorkspaceEntry(root: string, store: CheckpointStore, path: string, entry: CheckpointEntry | undefined): Promise<void> {
  const target = await requireWorkspaceMutationPath(join(resolve(root), path), root);
  if (entry === undefined) { await unlink(target).catch(() => undefined); return; }
  const bytes = await store.objects.read(entry.objectHash);
  await mkdir(dirname(target), { recursive: true });
  try { await requireWorkspaceMutationPath(target, root); } catch (error) { console.error('checkpoint target rejected after mkdir', { target, root, error }); throw error; }
  await rm(target, { force: true }).catch(() => undefined);
  if (entry.kind === 'symlink') await symlink(bytes.toString('utf8'), target); else await writeFile(target, bytes);
}
async function restoreRecovery(root: string, current: Map<string, WorkspaceEntry | undefined>): Promise<void> { for (const [path, entry] of current) { const target = await requireWorkspaceMutationPath(join(resolve(root), path), root); if (entry === undefined) await unlink(target).catch(() => undefined); else { await mkdir(dirname(target), { recursive: true }); await requireWorkspaceMutationPath(target, root); await rm(target, { force: true }).catch(() => undefined); if (entry.kind === 'symlink') await symlink(entry.bytes.toString('utf8'), target); else await writeFile(target, entry.bytes); } } }
function matches(actual: WorkspaceEntry | undefined, expected: CheckpointEntry | undefined): boolean { return actual === undefined ? expected === undefined : expected !== undefined && actual.kind === expected.kind && hashObject(actual.kind, actual.bytes) === expected.hash; }
function sameWorkspaceEntry(left: WorkspaceEntry | undefined, right: WorkspaceEntry | undefined): boolean { return left !== undefined && right !== undefined && left.kind === right.kind && hashObject(left.kind, left.bytes) === hashObject(right.kind, right.bytes); }
function uniqueMutationPaths(mutations: readonly CheckpointMutation[]): string[] { return [...new Set(mutations.flatMap(mutation => [mutation.path, ...(mutation.fromPath === undefined ? [] : [mutation.fromPath])]))]; }
function changedPathCount(mutations: readonly CheckpointMutation[]): number { return uniqueMutationPaths(mutations).length; }
function stringValue(value: unknown): string | undefined { return typeof value === 'string' && value.length > 0 ? value : undefined; }
function undoState(value: CheckpointRecord['state']): 'ready' | 'undone' | 'conflict' | 'failed' | undefined { return value === 'ready' || value === 'undone' || value === 'conflict' || value === 'failed' ? value : undefined; }

async function verifyCurrentBeforeRestore(root: string, mutation: CheckpointMutation): Promise<void> {
  const actual = await readWorkspaceEntry(root, mutation.path);
  if (!matches(actual, mutation.after) || mutation.fromPath !== undefined && (await readWorkspaceEntry(root, mutation.fromPath)) !== undefined) throw new Error(`Undo conflict detected for ${mutation.path}.`);
}
