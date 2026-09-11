import { randomUUID } from 'node:crypto';
import { access, copyFile, mkdir, mkdtemp, readFile, rename, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { DesktopHostRequest, DesktopHostResponse } from '../../contracts/agent-protocol/v1/desktop.js';
import type { Artifact } from '../../contracts/ipc/v1/workspace.js';
import { requireDirectory, requireWorkspaceMutationPath, requireExistingPath } from '../security/path-policy.js';
import { PowerShellDocumentBackend } from './document-process-runner.js';
import type { DocumentBackend } from './document-backend.js';
import { DOCUMENT_FORMATS, FORMAT_EXTENSIONS, type DocumentFormat } from './document-constants.js';
import { HostCapabilityRegistry } from '../host/host-capability-registry.js';
import { artifactKind } from '../artifacts/artifact-kind.js';
import { desktopDataPath } from '../persistence/app-data-paths.js';

export interface DocumentArtifactPublisher {
  importFile(taskId: string, sourcePath: string, kind: Artifact['kind']): Promise<Artifact>;
  replaceFile(taskId: string, artifactId: string, sourcePath: string): Promise<Artifact>;
}

export interface DocumentArtifactDescriptor { id: string; name: string; kind: Artifact['kind']; sizeBytes: number; }

interface DocumentHandle { id: string; sessionKey: string; cwd: string; path: string; format: DocumentFormat; backendId: string; openedAt: string; taskId?: string; artifactId?: string; stagingRoot?: string; }
interface ArtifactOutputContext { taskId: string; root: string; persistent: boolean; }

/** Owns document handles and delegates format-specific work to a bounded native backend. */
export class DocumentHostToolBroker {
  private readonly handles = new Map<string, DocumentHandle>();
  private readonly serial = new Map<string, Promise<void>>();
  private readonly sessions = new Map<string, Set<string>>();

  private readonly backend: DocumentBackend;
  private readonly capabilities: HostCapabilityRegistry;
  private readonly artifactPublisher: DocumentArtifactPublisher | undefined;

  constructor(backend: DocumentBackend | string, artifactPublisher?: DocumentArtifactPublisher) {
    this.backend = typeof backend === 'string' ? new PowerShellDocumentBackend(backend) : backend;
    this.capabilities = new HostCapabilityRegistry({ documents: this.backend.capabilities });
    this.artifactPublisher = artifactPublisher;
  }

  async handle(cwd: string, request: DesktopHostRequest, signal?: AbortSignal): Promise<DesktopHostResponse> {
    let executionRoot: string;
    try { executionRoot = request.executionCwd === undefined ? await requireDirectory(cwd) : await requireDirectory(request.executionCwd); }
    catch (error) { return this.error(request, 'DOCUMENT_PATH_INVALID', error instanceof Error ? error.message : 'The document execution workspace is invalid.'); }
    const key = `${cwd}\u0000${request.sessionId}\u0000${executionRoot}`;
    const previous = this.serial.get(key) ?? Promise.resolve();
    const operation = previous.catch(() => undefined).then(() => this.execute(executionRoot, request, key, signal));
    const barrier = operation.then(() => undefined, () => undefined);
    this.serial.set(key, barrier);
    try { return await operation; }
    catch (error) { return this.error(request, 'DOCUMENT_HOST_ERROR', error instanceof Error ? error.message : 'Document action failed.'); }
    finally { if (this.serial.get(key) === barrier) this.serial.delete(key); }
  }

  async closeForSession(cwd: string, sessionId: string): Promise<void> {
    const prefix = `${cwd}\u0000${sessionId}\u0000`;
    for (const key of [...this.sessions.keys()]) if (key.startsWith(prefix)) {
      for (const handleId of this.sessions.get(key) ?? []) await this.closeHandle(handleId);
      this.sessions.delete(key);
      this.serial.delete(key);
    }
  }

  async closeForWorkspace(cwd: string): Promise<void> {
    for (const key of [...this.sessions.keys()]) if (key.startsWith(`${cwd}\u0000`)) {
      for (const handleId of this.sessions.get(key) ?? []) await this.closeHandle(handleId);
      this.sessions.delete(key);
      this.serial.delete(key);
    }
  }

  private async execute(cwd: string, request: DesktopHostRequest, sessionKey: string, signal?: AbortSignal): Promise<DesktopHostResponse> {
    if (signal?.aborted === true) throw new Error('Document action was cancelled.');
    const [formatToken, actionToken] = request.action.split('.', 2);
    if (!isDocumentFormat(formatToken) || actionToken === undefined) throw new Error('Invalid document action.');
    this.requireCapability(formatToken, request.action);
    if (actionToken === 'open' || actionToken === 'create') return this.open(cwd, request, sessionKey, formatToken, actionToken, signal);
    if (actionToken === 'validate') {
      const target = await requireExistingPath(requiredPath(request.params['path']), cwd);
      assertFormat(target, formatToken);
      return this.success(request, await this.backend.execute(cwd, { action: request.action, path: target, params: request.params }, signal));
    }
    if (formatToken === 'pdf' && actionToken === 'merge') {
      const artifactContext = await this.requireArtifactOutputContext(request, false);
      try {
        const outputPath = await resolveOutputPath(cwd, requiredPath(request.params['outputPath']), artifactContext);
        assertFormat(outputPath, 'pdf');
        const params = await normalizePathParams(cwd, request.params, path => resolveOutputPath(cwd, path, artifactContext));
        const result = await this.backend.execute(cwd, { action: request.action, path: outputPath, params }, signal);
        const published = await this.publishGeneratedArtifacts(artifactContext, undefined, [outputPath], result);
        return this.success(request, result, published);
      } finally { await this.cleanupArtifactOutputContext(artifactContext); }
    }
    if (actionToken === 'close') {
      const handle = this.requireHandle(request, formatToken, sessionKey);
      await this.closeHandle(handle.id); this.sessions.get(sessionKey)?.delete(handle.id);
      return this.success(request, { closed: true, handleId: handle.id });
    }
    const handle = this.requireHandle(request, formatToken, sessionKey);
    if (actionToken !== 'validate') await access(handle.path);
    const artifactContext = this.artifactContextForHandle(handle, request) ?? await this.createArtifactOutputContext(request, shouldStageHandleOutput(handle, actionToken, request.params));
    try {
      const params = await normalizePathParams(cwd, request.params, path => resolveOutputPath(cwd, path, artifactContext));
      const result = await this.backend.execute(cwd, { action: request.action, path: handle.path, params }, signal);
      if (actionToken === 'save') {
        await verifyFile(handle.path);
        if (typeof params['outputPath'] === 'string' && params['outputPath'] !== handle.path) await atomicCopy(handle.path, params['outputPath']);
      }
      const explicitPaths = typeof params['outputPath'] === 'string' ? [params['outputPath']] : [];
      const published = await this.publishGeneratedArtifacts(artifactContext, handle, explicitPaths, result);
      return this.success(request, result, published);
    } finally { await this.cleanupArtifactOutputContext(artifactContext); }
  }

  private async open(cwd: string, request: DesktopHostRequest, sessionKey: string, format: DocumentFormat, action: string, signal?: AbortSignal): Promise<DesktopHostResponse> {
    const rawPath = requiredPath(request.params['path']);
    const validatedPath = action === 'create' ? await requireWorkspaceMutationPath(rawPath, cwd) : await requireExistingPath(rawPath, cwd);
    assertFormat(validatedPath, format);
    const artifactContext = await this.requireArtifactOutputContext(request, true);
    const target = join(artifactContext.root, basename(validatedPath));
    try {
      if (action === 'create') {
        await mkdir(dirname(target), { recursive: true });
        const result = await this.backend.execute(cwd, { action: request.action, path: target, params: request.params }, signal);
        const published = await this.publishGeneratedArtifacts(artifactContext, undefined, [target], result);
        const artifact = published.find(item => item.path === target)?.artifact;
        if (artifact === undefined) throw new Error('The document was created but could not be stored as a Desktop artifact.');
        const handle: DocumentHandle = { id: randomUUID(), sessionKey, cwd, path: target, format, backendId: this.backend.id, openedAt: new Date().toISOString(), taskId: artifactContext.taskId, stagingRoot: artifactContext.root, artifactId: artifact.id };
        this.handles.set(handle.id, handle);
        const handles = this.sessions.get(sessionKey) ?? new Set<string>(); handles.add(handle.id); this.sessions.set(sessionKey, handles);
        const details = await stat(target);
        return this.success(request, { handleId: handle.id, format, path: relative(cwd, validatedPath) || '.', sizeBytes: details.size, openedAt: handle.openedAt }, published);
      }
      await copyFile(validatedPath, target);
      const published = await this.publishGeneratedArtifacts(artifactContext, undefined, [target], undefined);
      const artifact = published.find(item => item.path === target)?.artifact;
      if (artifact === undefined) throw new Error('The document could not be stored as a Desktop artifact.');
      const handle: DocumentHandle = { id: randomUUID(), sessionKey, cwd, path: target, format, backendId: this.backend.id, openedAt: new Date().toISOString(), taskId: artifactContext.taskId, stagingRoot: artifactContext.root, artifactId: artifact.id };
      this.handles.set(handle.id, handle);
      const handles = this.sessions.get(sessionKey) ?? new Set<string>(); handles.add(handle.id); this.sessions.set(sessionKey, handles);
      const details = await stat(target);
      return this.success(request, { handleId: handle.id, format, path: relative(cwd, validatedPath) || '.', sizeBytes: details.size, openedAt: handle.openedAt }, published);
    } catch (error) {
      if (artifactContext !== undefined && ![...this.handles.values()].some(handle => handle.stagingRoot === artifactContext.root)) await this.cleanupArtifactOutputContext(artifactContext);
      throw error;
    }
  }

  private requireHandle(request: DesktopHostRequest, format: DocumentFormat, sessionKey: string): DocumentHandle {
    const id = request.params['handleId'];
    if (typeof id !== 'string' || id.length === 0) throw new Error('A document handleId is required.');
    const handle = this.handles.get(id);
    if (handle === undefined || handle.format !== format || handle.sessionKey !== sessionKey || handle.backendId !== this.backend.id) throw new Error('The document handle is invalid or belongs to another session, format, or backend.');
    return handle;
  }

  private requireCapability(format: DocumentFormat, action: string): void {
    if (!this.capabilities.supportsDocument(format, action)) throw new Error(this.capabilities.documentReason(format, action) ?? `The configured document provider does not support ${action}.`);
  }

  private success(request: DesktopHostRequest, result: unknown, artifacts: readonly PublishedArtifact[] = []): DesktopHostResponse { return { version: 1, type: 'host.response', requestId: request.requestId, tool: 'document', executionBoundary: 'host', ok: true, result, ...(artifacts.length === 0 ? {} : { artifacts: artifacts.map(item => artifactDescriptor(item.artifact)) }) }; }
  private error(request: DesktopHostRequest, code: string, message: string): DesktopHostResponse { return { version: 1, type: 'host.response', requestId: request.requestId, tool: 'document', executionBoundary: 'host', ok: false, error: { code, category: 'document', message, retryable: false } }; }

  private async createArtifactOutputContext(request: DesktopHostRequest, persistent: boolean): Promise<ArtifactOutputContext | undefined> {
    if (this.artifactPublisher === undefined || request.taskId === undefined) return undefined;
    const parent = desktopDataPath('document-output');
    await mkdir(parent, { recursive: true });
    return { taskId: request.taskId, root: await mkdtemp(join(parent, 'document-')), persistent };
  }

  private async requireArtifactOutputContext(request: DesktopHostRequest, persistent: boolean): Promise<ArtifactOutputContext> {
    const context = await this.createArtifactOutputContext(request, persistent);
    if (context === undefined) throw new Error('Document artifact storage is required for generated files.');
    return context;
  }

  private artifactContextForHandle(handle: DocumentHandle, request: DesktopHostRequest): ArtifactOutputContext | undefined {
    if (this.artifactPublisher === undefined || handle.taskId === undefined || handle.stagingRoot === undefined || handle.artifactId === undefined) return undefined;
    if (request.taskId !== undefined && request.taskId !== handle.taskId) throw new Error('The document handle belongs to another task.');
    return { taskId: handle.taskId, root: handle.stagingRoot, persistent: true };
  }

  private async cleanupArtifactOutputContext(context: ArtifactOutputContext | undefined): Promise<void> {
    if (context !== undefined && !context.persistent) await rm(context.root, { recursive: true, force: true });
  }

  private async closeHandle(handleId: string): Promise<void> {
    const handle = this.handles.get(handleId);
    if (handle === undefined) return;
    this.handles.delete(handleId);
    if (handle.stagingRoot !== undefined) await rm(handle.stagingRoot, { recursive: true, force: true });
  }

  private async publishGeneratedArtifacts(context: ArtifactOutputContext | undefined, handle: DocumentHandle | undefined, explicitPaths: readonly string[], result: unknown): Promise<PublishedArtifact[]> {
    if (context === undefined || this.artifactPublisher === undefined) return [];
    const candidates = new Set(explicitPaths);
    collectResultPaths(result, candidates);
    if (handle?.artifactId !== undefined) candidates.add(handle.path);
    const published: PublishedArtifact[] = [];
    for (const candidate of candidates) {
      const path = await fileInside(context.root, candidate);
      if (path === undefined) continue;
      const artifact = handle?.artifactId !== undefined && path === handle.path
        ? await this.artifactPublisher.replaceFile(context.taskId, handle.artifactId, path)
        : await this.artifactPublisher.importFile(context.taskId, path, artifactKind(path));
      published.push({ artifact, path });
    }
    return published;
  }
}

interface PublishedArtifact { artifact: Artifact; path: string; }

function isDocumentFormat(value: string | undefined): value is DocumentFormat { return value !== undefined && DOCUMENT_FORMATS.includes(value as DocumentFormat); }
function requiredPath(value: unknown): string { if (typeof value !== 'string' || value.trim().length === 0 || value.includes('\0') || value.length > 4_096) throw new Error('A valid document path is required.'); return value; }
function assertFormat(path: string, format: DocumentFormat): void { const extension = extname(path).toLowerCase(); if (!FORMAT_EXTENSIONS[format].includes(extension)) throw new Error(`The path extension does not match the ${format} document plugin.`); }
async function verifyFile(path: string): Promise<void> { const details = await stat(path); if (!details.isFile() || details.size === 0) throw new Error('The document backend did not produce a valid file.'); }
async function atomicCopy(source: string, target: string): Promise<void> {
  await mkdir(dirname(target), { recursive: true });
  const temporary = `${target}.${randomUUID()}.tmp`;
  try { await writeFile(temporary, await readFile(source), { flag: 'wx' }); await rename(temporary, target); }
  finally { await unlink(temporary).catch(() => undefined); }
}
async function normalizePathParams(cwd: string, params: Record<string, unknown>, outputResolver: (path: string) => Promise<string> = path => requireWorkspaceMutationPath(path, cwd)): Promise<Record<string, unknown>> {
  const normalized = { ...params };
  for (const key of ['sourcePath', 'imagePath', 'mediaPath'] as const) if (normalized[key] !== undefined) normalized[key] = await requireExistingPath(requiredPath(normalized[key]), cwd);
  if (normalized['outputPath'] !== undefined) normalized['outputPath'] = await outputResolver(requiredPath(normalized['outputPath']));
  if (normalized['paths'] !== undefined) {
    const values = normalized['paths'];
    if (!Array.isArray(values) || values.some(value => typeof value !== 'string')) throw new Error('Document paths must be an array of strings.');
    normalized['paths'] = await Promise.all(values.map(value => requireExistingPath(requiredPath(value), cwd)));
  }
  return normalized;
}

async function resolveOutputPath(cwd: string, rawPath: string, context: ArtifactOutputContext | undefined): Promise<string> {
  const validated = await requireWorkspaceMutationPath(rawPath, cwd);
  if (context === undefined) throw new Error('Document artifact storage is required for generated files.');
  return join(context.root, basename(validated));
}

function shouldStageHandleOutput(handle: DocumentHandle, action: string, params: Record<string, unknown>): boolean {
  if (handle.artifactId !== undefined && handle.stagingRoot !== undefined && handle.taskId !== undefined) return true;
  if (typeof params['outputPath'] === 'string' && params['outputPath'].trim().length > 0) return true;
  return ['render', 'exportPdf', 'exportCsv', 'extractImages', 'split'].includes(action);
}

function collectResultPaths(value: unknown, output: Set<string>, depth = 0): void {
  if (depth > 6 || value === null || value === undefined) return;
  if (typeof value === 'string') return;
  if (Array.isArray(value)) { for (const item of value.slice(0, 256)) collectResultPaths(item, output, depth + 1); return; }
  if (typeof value !== 'object') return;
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (key === 'path' || key === 'outputPath' || key === 'files') {
      if (typeof item === 'string') output.add(item);
      else if (Array.isArray(item)) for (const candidate of item) if (typeof candidate === 'string') output.add(candidate);
    } else collectResultPaths(item, output, depth + 1);
  }
}

async function fileInside(root: string, candidate: string): Promise<string | undefined> {
  const normalizedRoot = resolve(root);
  const normalizedCandidate = resolve(isAbsolute(candidate) ? candidate : join(normalizedRoot, candidate));
  if (normalizedCandidate !== normalizedRoot && !normalizedCandidate.startsWith(`${normalizedRoot}${sep}`)) return undefined;
  try { const details = await stat(normalizedCandidate); return details.isFile() && details.size > 0 ? normalizedCandidate : undefined; } catch { return undefined; }
}

function artifactDescriptor(artifact: Artifact): DocumentArtifactDescriptor { return { id: artifact.id, name: artifact.name, kind: artifact.kind, sizeBytes: artifact.size }; }
