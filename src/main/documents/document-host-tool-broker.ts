import { randomUUID } from 'node:crypto';
import { access, mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, extname, relative } from 'node:path';
import type { DesktopHostRequest, DesktopHostResponse } from '../../contracts/agent-protocol/v1/desktop.js';
import { requireWorkspaceMutationPath, requireExistingPath } from '../security/path-policy.js';
import { runDocumentBackend } from './document-process-runner.js';
import { FORMAT_EXTENSIONS, type DocumentFormat } from './document-constants.js';

interface DocumentHandle { id: string; sessionKey: string; cwd: string; path: string; format: DocumentFormat; openedAt: string; }

/** Owns document handles and delegates format-specific work to a bounded native backend. */
export class DocumentHostToolBroker {
  private readonly handles = new Map<string, DocumentHandle>();
  private readonly serial = new Map<string, Promise<void>>();
  private readonly sessions = new Map<string, Set<string>>();

  constructor(private readonly backendPath: string) {}

  async handle(cwd: string, request: DesktopHostRequest, signal?: AbortSignal): Promise<DesktopHostResponse> {
    const key = `${cwd}\u0000${request.sessionId}`;
    let executionRoot: string;
    try { executionRoot = request.executionCwd === undefined ? cwd : await requireExistingPath(request.executionCwd, cwd); }
    catch (error) { return this.error(request, 'DOCUMENT_PATH_INVALID', error instanceof Error ? error.message : 'The document execution workspace is invalid.'); }
    const previous = this.serial.get(key) ?? Promise.resolve();
    const operation = previous.catch(() => undefined).then(() => this.execute(executionRoot, request, key, signal));
    const barrier = operation.then(() => undefined, () => undefined);
    this.serial.set(key, barrier);
    try { return await operation; }
    catch (error) { return this.error(request, 'DOCUMENT_HOST_ERROR', error instanceof Error ? error.message : 'Document action failed.'); }
    finally { if (this.serial.get(key) === barrier) this.serial.delete(key); }
  }

  async closeForSession(cwd: string, sessionId: string): Promise<void> {
    const key = `${cwd}\u0000${sessionId}`;
    for (const handleId of this.sessions.get(key) ?? []) this.handles.delete(handleId);
    this.sessions.delete(key);
    this.serial.delete(key);
  }

  async closeForWorkspace(cwd: string): Promise<void> {
    for (const key of [...this.sessions.keys()]) if (key.startsWith(`${cwd}\u0000`)) await this.closeForSession(cwd, key.slice(cwd.length + 1));
  }

  private async execute(cwd: string, request: DesktopHostRequest, sessionKey: string, signal?: AbortSignal): Promise<DesktopHostResponse> {
    if (signal?.aborted === true) throw new Error('Document action was cancelled.');
    const [formatToken, actionToken] = request.action.split('.', 2);
    if (!isDocumentFormat(formatToken) || actionToken === undefined) throw new Error('Invalid document action.');
    if (actionToken === 'open' || actionToken === 'create') return this.open(cwd, request, sessionKey, formatToken, actionToken, signal);
    if (actionToken === 'validate') {
      const target = await requireExistingPath(requiredPath(request.params['path']), cwd);
      assertFormat(target, formatToken);
      return this.success(request, await runDocumentBackend(this.backendPath, cwd, { action: request.action, path: target, params: request.params }, signal));
    }
    if (formatToken === 'pdf' && actionToken === 'merge') {
      const outputPath = await requireWorkspaceMutationPath(requiredPath(request.params['outputPath']), cwd);
      assertFormat(outputPath, 'pdf');
      return this.success(request, await runDocumentBackend(this.backendPath, cwd, { action: request.action, path: outputPath, params: request.params }, signal));
    }
    if (actionToken === 'close') {
      const handle = this.requireHandle(request, formatToken, sessionKey);
      this.handles.delete(handle.id); this.sessions.get(sessionKey)?.delete(handle.id);
      return this.success(request, { closed: true, handleId: handle.id });
    }
    const handle = this.requireHandle(request, formatToken, sessionKey);
    if (actionToken !== 'validate') await access(handle.path);
    const params = await normalizePathParams(cwd, request.params);
    const result = await runDocumentBackend(this.backendPath, cwd, { action: request.action, path: handle.path, params }, signal);
    if (actionToken === 'save') {
      await verifyFile(handle.path);
      if (typeof params['outputPath'] === 'string' && params['outputPath'] !== handle.path) await atomicCopy(handle.path, params['outputPath']);
    }
    return this.success(request, result);
  }

  private async open(cwd: string, request: DesktopHostRequest, sessionKey: string, format: DocumentFormat, action: string, signal?: AbortSignal): Promise<DesktopHostResponse> {
    const rawPath = requiredPath(request.params['path']);
    const target = action === 'create' ? await requireWorkspaceMutationPath(rawPath, cwd) : await requireExistingPath(rawPath, cwd);
    assertFormat(target, format);
    if (action === 'create') { await mkdir(dirname(target), { recursive: true }); await runDocumentBackend(this.backendPath, cwd, { action: request.action, path: target, params: request.params }, signal); }
    const handle: DocumentHandle = { id: randomUUID(), sessionKey, cwd, path: target, format, openedAt: new Date().toISOString() };
    this.handles.set(handle.id, handle);
    const handles = this.sessions.get(sessionKey) ?? new Set<string>(); handles.add(handle.id); this.sessions.set(sessionKey, handles);
    const details = await stat(target);
    return this.success(request, { handleId: handle.id, format, path: relative(cwd, target) || '.', sizeBytes: details.size, openedAt: handle.openedAt });
  }

  private requireHandle(request: DesktopHostRequest, format: DocumentFormat, sessionKey: string): DocumentHandle {
    const id = request.params['handleId'];
    if (typeof id !== 'string' || id.length === 0) throw new Error('A document handleId is required.');
    const handle = this.handles.get(id);
    if (handle === undefined || handle.format !== format || handle.sessionKey !== sessionKey) throw new Error('The document handle is invalid or belongs to another session or format.');
    return handle;
  }

  private success(request: DesktopHostRequest, result: unknown): DesktopHostResponse { return { version: 1, type: 'host.response', requestId: request.requestId, tool: 'document', executionBoundary: 'host', ok: true, result }; }
  private error(request: DesktopHostRequest, code: string, message: string): DesktopHostResponse { return { version: 1, type: 'host.response', requestId: request.requestId, tool: 'document', executionBoundary: 'host', ok: false, error: { code, category: 'document', message, retryable: false } }; }
}

function isDocumentFormat(value: string | undefined): value is DocumentFormat { return value === 'pdf' || value === 'pptx' || value === 'excel' || value === 'docs'; }
function requiredPath(value: unknown): string { if (typeof value !== 'string' || value.trim().length === 0 || value.includes('\0') || value.length > 4_096) throw new Error('A valid document path is required.'); return value; }
function assertFormat(path: string, format: DocumentFormat): void { const extension = extname(path).toLowerCase(); if (!FORMAT_EXTENSIONS[format].includes(extension)) throw new Error(`The path extension does not match the ${format} document plugin.`); }
async function verifyFile(path: string): Promise<void> { const details = await stat(path); if (!details.isFile() || details.size === 0) throw new Error('The document backend did not produce a valid file.'); }
async function atomicCopy(source: string, target: string): Promise<void> {
  await mkdir(dirname(target), { recursive: true });
  const temporary = `${target}.${randomUUID()}.tmp`;
  try { await writeFile(temporary, await readFile(source), { flag: 'wx' }); await rename(temporary, target); }
  finally { await unlink(temporary).catch(() => undefined); }
}
async function normalizePathParams(cwd: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const normalized = { ...params };
  for (const key of ['sourcePath', 'imagePath', 'mediaPath'] as const) if (normalized[key] !== undefined) normalized[key] = await requireExistingPath(requiredPath(normalized[key]), cwd);
  if (normalized['outputPath'] !== undefined) normalized['outputPath'] = await requireWorkspaceMutationPath(requiredPath(normalized['outputPath']), cwd);
  if (normalized['paths'] !== undefined) {
    const values = normalized['paths'];
    if (!Array.isArray(values) || values.some(value => typeof value !== 'string')) throw new Error('Document paths must be an array of strings.');
    normalized['paths'] = await Promise.all(values.map(value => requireExistingPath(value, cwd)));
  }
  return normalized;
}
