import { spawn } from 'node:child_process';
import { access, mkdir, opendir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import type { DesktopHostRequest, DesktopHostResponse } from '../../contracts/agent-protocol/v1/desktop.js';
import type { SandboxExecutionProvider } from './sandbox-execution-provider.js';
import { SandboxUnavailableError } from './sandbox-execution-provider.js';
import type { FileChangeDiff, FileDiffLine } from '../../contracts/ipc/v1/workspace.js';

const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 30_000;

export interface DesktopHostExecutionBrokerOptions {
  sandbox?: SandboxExecutionProvider;
  onFileChanged?: (cwd: string, change: { path: string; kind: 'created' | 'modified' }) => void;
}

/**
 * Executes only explicitly brokered operations on the Desktop host. The
 * broker is deliberately independent from renderer IPC and receives a
 * canonical workspace cwd from AgentManager.
 */
export class DesktopHostExecutionBroker {
  constructor(private readonly options: DesktopHostExecutionBrokerOptions = {}) {}

  async handle(cwd: string, request: DesktopHostRequest, signal?: AbortSignal): Promise<DesktopHostResponse> {
    if (request.executionBoundary === 'sandbox') return this.handleSandbox(cwd, request, signal);
    return this.handleHost(cwd, request, signal);
  }

  private async handleSandbox(cwd: string, request: DesktopHostRequest, signal?: AbortSignal): Promise<DesktopHostResponse> {
    if (this.options.sandbox === undefined) return this.sandboxFallback(cwd, request, signal, 'The Desktop sandbox runtime is not configured.');
    try {
      const result = await this.options.sandbox.execute({ root: cwd, action: request.action, params: request.params, ...(signal === undefined ? {} : { signal }) });
      if (result.fileChange !== undefined) this.options.onFileChanged?.(cwd, { path: result.fileChange.path, kind: result.fileChange.deletions === 0 ? 'created' : 'modified' });
      return { version: 2, type: 'host.response', requestId: request.requestId, tool: request.tool, executionBoundary: 'sandbox', ok: true, result: result.result, ...(result.fileChange === undefined ? {} : { fileChange: result.fileChange }) };
    } catch (error) {
      if (error instanceof SandboxUnavailableError) return this.sandboxFallback(cwd, request, signal, error.message);
      return this.errorResponse(request, 'SANDBOX_EXECUTION_FAILED', error instanceof Error ? error.message : 'Sandbox execution failed.', 'sandbox');
    }
  }

  private async handleHost(cwd: string, request: DesktopHostRequest, signal?: AbortSignal): Promise<DesktopHostResponse> {
    try {
      const outcome = request.tool === 'filesystem'
        ? await this.filesystem(cwd, request.action, request.params)
        : request.tool === 'shell' || request.tool === 'git'
          ? await this.shell(cwd, request.params, signal)
          : request.tool === 'artifact'
            ? this.unsupported('Artifact host execution is not available yet.')
            : this.unsupported('The requested host operation is not available through this broker.');
      const result = isFilesystemOutcome(outcome) ? outcome.result : outcome;
      const fileChange = isFilesystemOutcome(outcome) ? outcome.fileChange : undefined;
      return { version: 2, type: 'host.response', requestId: request.requestId, tool: request.tool, executionBoundary: 'host', ok: true, result, ...(fileChange === undefined ? {} : { fileChange }) };
    } catch (error) {
      return this.errorResponse(request, 'HOST_EXECUTION_FAILED', error instanceof Error ? error.message : 'Host execution failed.', 'host');
    }
  }

  private sandboxFallback(cwd: string, request: DesktopHostRequest, signal: AbortSignal | undefined, reason: string): Promise<DesktopHostResponse> | DesktopHostResponse {
    if (request.hostFallback === 'allow') return this.handleHost(cwd, { ...request, executionBoundary: 'host' }, signal);
    return this.errorResponse(request, request.hostFallback === 'ask' ? 'SANDBOX_FALLBACK_REQUIRED' : 'SANDBOX_UNAVAILABLE', request.hostFallback === 'ask' ? 'The sandbox is unavailable. Approve running this action outside the sandbox.' : reason, 'sandbox', request.hostFallback === 'ask');
  }

  private errorResponse(request: DesktopHostRequest, code: string, message: string, boundary: 'sandbox' | 'host', retryable = false): DesktopHostResponse {
    return { version: 2, type: 'host.response', requestId: request.requestId, tool: request.tool, executionBoundary: boundary, ok: false, error: { code, category: 'execution', message: redact(message), retryable } };
  }

  private async filesystem(root: string, action: string, params: Record<string, unknown>): Promise<unknown> {
    const pathValue = requiredString(params, 'path');
    const target = action === 'filesystem.write' ? await this.resolveWritePath(root, pathValue) : await this.resolveExistingPath(root, pathValue);
    if (action === 'filesystem.read') {
      const info = await stat(target);
      if (!info.isFile() || info.size > MAX_FILE_BYTES) throw new Error('The requested path is not a supported text file.');
      return (await readFile(target, 'utf8')).slice(0, MAX_FILE_BYTES);
    }
    if (action === 'filesystem.list') {
      const info = await stat(target);
      if (!info.isDirectory()) throw new Error('The requested path is not a directory.');
      const entries: Array<{ name: string; kind: 'file' | 'directory' }> = [];
      const directory = await opendir(target);
      try {
        for await (const entry of directory) {
          entries.push({ name: entry.name, kind: entry.isDirectory() ? 'directory' : 'file' });
          if (entries.length >= 2_000) break;
        }
      } finally { await directory.close(); }
      return entries;
    }
    if (action === 'filesystem.exists') return true;
    if (action === 'filesystem.write') {
      const content = params['content'];
      if (typeof content !== 'string') throw new Error('filesystem.write requires string content.');
      if (Buffer.byteLength(content, 'utf8') > MAX_FILE_BYTES) throw new Error('The requested file is too large.');
      const existed = await this.exists(target);
      const previous = existed ? await readFile(target, 'utf8').catch(() => '') : '';
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, content, 'utf8');
      const fileChange = createBoundedFileChange(relative(await realpath(root), target), previous, content, existed ? 'modified' : 'created');
      this.options.onFileChanged?.(root, { path: fileChange.path, kind: existed ? 'modified' : 'created' });
      return { result: `Wrote ${Buffer.byteLength(content, 'utf8')} bytes.`, fileChange };
    }
    throw new Error(`Unsupported filesystem host action: ${action}.`);
  }

  private async shell(root: string, params: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
    const command = requiredString(params, 'command');
    const args = params['args'] === undefined ? [] : params['args'];
    if (!Array.isArray(args) || args.some(item => typeof item !== 'string') || args.length > 256) throw new Error('shell.exec args must be an array of strings.');
    const cwd = await this.resolveExistingPath(root, typeof params['cwd'] === 'string' ? params['cwd'] : '.');
    const timeoutMs = typeof params['timeoutMs'] === 'number' && Number.isSafeInteger(params['timeoutMs']) ? Math.min(Math.max(params['timeoutMs'], 100), 120_000) : DEFAULT_TIMEOUT_MS;
    return runProcess(command, args as string[], cwd, timeoutMs, signal);
  }

  private async resolveExistingPath(root: string, input: string): Promise<string> {
    const canonicalRoot = await realpath(root);
    const candidate = resolve(canonicalRoot, input);
    assertInside(candidate, canonicalRoot);
    const canonical = await realpath(candidate);
    assertInside(canonical, canonicalRoot);
    await access(canonical);
    return canonical;
  }

  private async resolveWritePath(root: string, input: string): Promise<string> {
    const canonicalRoot = await realpath(root);
    const candidate = resolve(canonicalRoot, input);
    assertInside(candidate, canonicalRoot);
    try {
      const canonical = await realpath(candidate);
      assertInside(canonical, canonicalRoot);
      return canonical;
    } catch {
      const parent = await realpath(dirname(candidate));
      assertInside(parent, canonicalRoot);
      return candidate;
    }
  }

  private async exists(path: string): Promise<boolean> { try { await access(path); return true; } catch { return false; } }
  private unsupported(message: string): never { throw new Error(message); }
}

function runProcess(command: string, args: string[], cwd: string, timeoutMs: number, signal?: AbortSignal): Promise<Record<string, unknown>> {
  return new Promise(resolveResult => {
    const child = spawn(command, args, { cwd, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: safeEnvironment() });
    let stdout = ''; let stderr = ''; let bytes = 0; let truncated = false; let timedOut = false; let settled = false;
    const append = (chunk: Buffer, target: 'stdout' | 'stderr') => {
      if (truncated) return;
      const text = chunk.toString('utf8');
      const remaining = MAX_OUTPUT_BYTES - bytes;
      if (remaining <= 0) { truncated = true; child.kill(); return; }
      const accepted = Buffer.byteLength(text, 'utf8') <= remaining ? text : text.slice(0, remaining);
      bytes += Buffer.byteLength(accepted, 'utf8');
      if (target === 'stdout') stdout += accepted; else stderr += accepted;
      if (accepted.length !== text.length) { truncated = true; child.kill(); }
    };
    const finish = (value: Record<string, unknown>) => { if (settled) return; settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort); resolveResult(value); };
    const abort = () => { child.kill(); finish({ stdout, stderr, exitCode: null, cancelled: true }); };
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, timeoutMs);
    child.stdout.on('data', chunk => append(chunk, 'stdout'));
    child.stderr.on('data', chunk => append(chunk, 'stderr'));
    child.once('error', error => finish({ stdout, stderr: redact(error.message), exitCode: null, error: true }));
    child.once('close', code => finish({ stdout: redact(stdout), stderr: redact(stderr), exitCode: code, timedOut, truncated }));
    if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, { once: true });
  });
}

function requiredString(params: Record<string, unknown>, key: string): string { const value = params[key]; if (typeof value !== 'string' || value.trim().length === 0 || value.length > 4_096) throw new Error(`Host execution parameter "${key}" is invalid.`); return value; }
function isFilesystemOutcome(value: unknown): value is { result: unknown; fileChange: FileChangeDiff } { return typeof value === 'object' && value !== null && 'result' in value && 'fileChange' in value; }
function createBoundedFileChange(filePath: string, before: string, after: string, kind: 'created' | 'modified'): FileChangeDiff {
  const oldLines = before.length === 0 ? [] : before.split(/\r?\n/u);
  const newLines = after.length === 0 ? [] : after.split(/\r?\n/u);
  let prefix = 0;
  while (prefix < oldLines.length && prefix < newLines.length && oldLines[prefix] === newLines[prefix]) prefix += 1;
  let suffix = 0;
  while (suffix < oldLines.length - prefix && suffix < newLines.length - prefix && oldLines[oldLines.length - 1 - suffix] === newLines[newLines.length - 1 - suffix]) suffix += 1;
  const lines: FileDiffLine[] = [];
  for (let index = 0; index < prefix; index += 1) lines.push({ kind: 'context', text: oldLines[index] as string, oldLine: index + 1, newLine: index + 1 });
  for (let index = prefix; index < oldLines.length - suffix && lines.length < 512; index += 1) lines.push({ kind: 'deletion', text: oldLines[index] as string, oldLine: index + 1 });
  for (let index = prefix; index < newLines.length - suffix && lines.length < 512; index += 1) lines.push({ kind: 'addition', text: newLines[index] as string, newLine: index + 1 });
  for (let index = Math.max(prefix, oldLines.length - suffix); index < oldLines.length && lines.length < 512; index += 1) lines.push({ kind: 'context', text: oldLines[index] as string, oldLine: index + 1, newLine: newLines.length - oldLines.length + index + 1 });
  return { path: filePath || '.', lines, additions: Math.max(0, newLines.length - prefix - suffix), deletions: Math.max(0, oldLines.length - prefix - suffix), truncated: lines.length >= 512 || kind === 'created' && newLines.length > 512 };
}
function assertInside(candidate: string, root: string): void { const relativePath = relative(root, candidate); if (isAbsolute(relativePath) || relativePath === '..' || relativePath.startsWith(`..${sep}`)) throw new Error('Host execution path is outside the workspace boundary.'); }
function safeEnvironment(): NodeJS.ProcessEnv { const allowed = ['PATH', 'Path', 'PATHEXT', 'SystemRoot', 'TEMP', 'TMP', 'HOME', 'USERPROFILE', 'LANG', 'LC_ALL']; return Object.fromEntries(allowed.flatMap(key => process.env[key] === undefined ? [] : [[key, process.env[key] as string]])); }
function redact(value: string): string { return value.replace(/Bearer\s+[^\s]+/giu, 'Bearer [REDACTED]').replace(/sk-[A-Za-z0-9_-]{8,}/gu, '[REDACTED]'); }
