import { spawn } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import type { FileChangeDiff } from '../../contracts/ipc/v1/workspace.js';
import type { SandboxBackend, SandboxCleanupPolicy, SandboxMountMode, SandboxNetworkPolicy } from '../../contracts/ipc/v1/settings.js';
import { DESKTOP_RUNTIME_LIMITS } from '../../contracts/runtime-limits.js';
import { terminateDesktopProcess } from '../process/process-termination.js';
import { DEFAULT_IMAGE, DEFAULT_RUNTIME, SANDBOX_WORKSPACE_ROOT } from './sandbox-constants.js';

export interface SandboxExecutionInput {
  root: string;
  action: string;
  params: Record<string, unknown>;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface SandboxExecutionResult {
  result: unknown;
  fileChange?: FileChangeDiff;
}

export interface SandboxExecutionProvider {
  execute(input: SandboxExecutionInput): Promise<SandboxExecutionResult>;
}

export class SandboxUnavailableError extends Error {
  constructor(message: string) { super(message); this.name = 'SandboxUnavailableError'; }
}

export interface ContainerSandboxOptions {
  backend?: SandboxBackend;
  image?: string;
  network?: SandboxNetworkPolicy;
  mountMode?: SandboxMountMode;
  memoryMb?: number;
  cpuCores?: number;
  pidsLimit?: number;
  cleanup?: SandboxCleanupPolicy;
}

/**
 * Runs brokered filesystem and shell operations inside a disposable container.
 * The workspace is the only mounted path. The CLI process never receives a
 * host filesystem or shell executor when this provider is selected.
 */
export class ContainerSandboxExecutionProvider implements SandboxExecutionProvider {
  private readonly getOptions: () => Promise<ContainerSandboxOptions>;

  constructor(optionsOrResolver: ContainerSandboxOptions | (() => ContainerSandboxOptions | Promise<ContainerSandboxOptions>) = {}) { this.getOptions = typeof optionsOrResolver === 'function' ? async () => optionsOrResolver() : async () => optionsOrResolver; }

  async execute(input: SandboxExecutionInput): Promise<SandboxExecutionResult> {
    const root = await realpath(input.root);
    const options = await this.getOptions();
    if (options.backend === 'disabled') throw new SandboxUnavailableError('The Desktop sandbox is disabled in Settings.');
    const runtimeExecutables = runtimeCandidates(options.backend);
    const image = options.image ?? process.env['LOTAGATE_SANDBOX_IMAGE'] ?? DEFAULT_IMAGE;
    const network = options.network ?? 'none';
    const mountMode = options.mountMode ?? 'read-write';
    const memoryMb = options.memoryMb ?? 2_048;
    const cpuCores = options.cpuCores ?? 2;
    const pidsLimit = options.pidsLimit ?? 128;
    const cleanup = options.cleanup ?? 'always';
    const payload = JSON.stringify({ action: input.action, params: input.params });
    const timeoutMs = typeof input.timeoutMs === 'number' ? Math.min(Math.max(input.timeoutMs, DESKTOP_RUNTIME_LIMITS.minExecutionTimeoutMs), DESKTOP_RUNTIME_LIMITS.maxExecutionTimeoutMs) : DESKTOP_RUNTIME_LIMITS.defaultExecutionTimeoutMs;
    let unavailable: SandboxUnavailableError | undefined;
    for (const runtime of runtimeExecutables) {
      const containerName = `lotagate-sandbox-${randomUUID()}`;
      const response = await runContainer(runtime, [
        'run', '--interactive', ...(cleanup === 'always' ? ['--rm'] : []), '--name', containerName, '--init', '--network', network === 'none' ? 'none' : 'bridge',
        '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--pids-limit', String(pidsLimit),
        '--memory', `${memoryMb}m`, '--cpus', String(cpuCores), '--mount', `type=bind,source=${root},target=${SANDBOX_WORKSPACE_ROOT}${mountMode === 'read-only' ? ',readonly' : ''}`,
        '--workdir', SANDBOX_WORKSPACE_ROOT, image, 'node', '-e', CONTAINER_SCRIPT,
      ], payload, timeoutMs, input.signal);
      if (response.cancelled || response.timedOut) {
        await removeContainer(runtime, containerName).catch(() => undefined);
        throw new Error(response.message);
      }
      if (response.unavailable) { unavailable = new SandboxUnavailableError(response.message); continue; }
      if (response.exitCode !== 0) throw new Error(response.message || response.stderr.trim() || `Sandbox process exited with code ${String(response.exitCode)}.`);
      let parsed: unknown;
      try { parsed = JSON.parse(response.stdout); }
      catch { throw new Error('The sandbox returned an invalid execution result.'); }
      if (!isSandboxResult(parsed)) throw new Error('The sandbox returned an incomplete execution result.');
      if (parsed.ok !== true) throw new Error(parsed.error);
      if (cleanup === 'on-success') await removeContainer(runtime, containerName);
      return { result: parsed.result, ...(parsed.fileChange === undefined ? {} : { fileChange: emptyFileChange(parsed.fileChange) }) };
    }
    throw unavailable ?? new SandboxUnavailableError('No supported sandbox runtime is available.');
  }
}

async function removeContainer(runtime: string, name: string): Promise<void> {
  await runContainer(runtime, ['rm', '--force', name], '', DESKTOP_RUNTIME_LIMITS.containerCleanupTimeoutMs);
}

function runtimeCandidates(backend: SandboxBackend | undefined): readonly string[] {
  if (backend === 'docker') return ['docker'];
  if (backend === 'podman') return ['podman'];
  return [DEFAULT_RUNTIME, 'podman'];
}

type ContainerRunResult = { stdout: string; stderr: string; exitCode: number | null; unavailable: boolean; message: string; cancelled?: boolean; timedOut?: boolean; terminationConfirmed?: boolean };

function runContainer(executable: string, args: string[], input: string, timeoutMs: number, signal?: AbortSignal): Promise<ContainerRunResult> {
  if (signal?.aborted === true) return Promise.resolve({ stdout: '', stderr: '', exitCode: null, unavailable: false, message: 'Sandbox execution was cancelled.', cancelled: true, terminationConfirmed: true });
  return new Promise(resolve => {
    const child = spawn(executable, args, { shell: false, windowsHide: true, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let outputBytes = 0;
    let settled = false;
    let stopping = false;
    const append = (target: 'stdout' | 'stderr', chunk: Buffer): void => {
      if (outputBytes >= DESKTOP_RUNTIME_LIMITS.sandboxDefaultOutputBytes) return;
      const remaining = DESKTOP_RUNTIME_LIMITS.sandboxDefaultOutputBytes - outputBytes;
      const text = chunk.toString('utf8');
      const accepted = Buffer.from(text, 'utf8').subarray(0, remaining).toString('utf8');
      outputBytes += Buffer.byteLength(accepted, 'utf8');
      if (target === 'stdout') stdout += accepted; else stderr += accepted;
    };
    const finish = (value: ContainerRunResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      resolve(value);
    };
    const stop = (value: ContainerRunResult): void => {
      if (stopping || settled) return;
      stopping = true;
      void terminateDesktopProcess(child).then(() => finish({ ...value, terminationConfirmed: true }), error => finish({ ...value, terminationConfirmed: false, message: `${value.message} ${error instanceof Error ? error.message : 'Process termination could not be confirmed.'}` }));
    };
    const abort = (): void => stop({ stdout, stderr, exitCode: null, unavailable: false, message: 'Sandbox execution was cancelled.', cancelled: true });
    const timer = setTimeout(() => stop({ stdout, stderr, exitCode: null, unavailable: false, message: `Sandbox execution timed out after ${timeoutMs}ms.`, timedOut: true }), timeoutMs);
    child.stdout.on('data', chunk => append('stdout', Buffer.from(chunk)));
    child.stderr.on('data', chunk => append('stderr', Buffer.from(chunk)));
    child.once('error', error => {
      if (stopping) return;
      const code = (error as NodeJS.ErrnoException).code;
      finish({ stdout, stderr, exitCode: null, unavailable: code === 'ENOENT', message: code === 'ENOENT' ? `Sandbox runtime "${executable}" was not found.` : error.message });
    });
    child.once('close', code => {
      if (stopping) return;
      if (code === 125 || code === 126) finish({ stdout, stderr, exitCode: code, unavailable: true, message: redactUnavailable(stderr, executable) });
      else finish({ stdout, stderr, exitCode: code, unavailable: false, message: '' });
    });
    child.stdin.end(input);
    if (signal?.aborted === true) abort(); else signal?.addEventListener('abort', abort, { once: true });
  });
}

function redactUnavailable(stderr: string, executable: string): string {
  const detail = stderr.trim();
  if (/daemon|cannot connect|image|pull access|not found|is not recognized/iu.test(detail)) return `Sandbox runtime "${executable}" is unavailable or the configured image is not ready.`;
  return 'The sandbox runtime could not start the isolated process.';
}

function isSandboxResult(value: unknown): value is { ok: boolean; result?: unknown; error?: string; fileChange?: { path: string; kind: 'created' | 'modified' } } {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  const change = record['fileChange'];
  return typeof record['ok'] === 'boolean'
    && (change === undefined || (typeof change === 'object' && change !== null && typeof (change as Record<string, unknown>)['path'] === 'string' && ((change as Record<string, unknown>)['kind'] === 'created' || (change as Record<string, unknown>)['kind'] === 'modified')));
}

function emptyFileChange(change: { path: string; kind: 'created' | 'modified' }): FileChangeDiff {
  return { path: change.path, lines: [], additions: 0, deletions: 0, truncated: true };
}

// Keep the isolated runner self-contained, but derive its limits from the same
// Desktop contract used by the host broker.
const CONTAINER_SCRIPT = String.raw`const fs=require('node:fs');const path=require('node:path');const cp=require('node:child_process');const input=JSON.parse(fs.readFileSync(0,'utf8'));const root=${JSON.stringify(SANDBOX_WORKSPACE_ROOT)};const max=${DESKTOP_RUNTIME_LIMITS.hostFileBytes};const inside=(value)=>{const target=path.resolve(root,value||'.');const rel=path.relative(root,target);if(rel==='..'||rel.startsWith('..'+path.sep)||path.isAbsolute(rel))throw new Error('Path is outside the workspace boundary.');return target};const output=(value,change)=>process.stdout.write(JSON.stringify({ok:true,result:value,...(change?{fileChange:change}:{})}));try{const p=input.params||{};if(input.action==='filesystem.read'){const target=inside(p.path);const info=fs.statSync(target);if(!info.isFile()||info.size>max)throw new Error('The requested path is not a supported text file.');output(fs.readFileSync(target,'utf8').slice(0,max));}else if(input.action==='filesystem.list'){const target=inside(p.path);if(!fs.statSync(target).isDirectory())throw new Error('The requested path is not a directory.');output(fs.readdirSync(target,{withFileTypes:true}).slice(0,${DESKTOP_RUNTIME_LIMITS.sandboxMaxDirectoryEntries}).map(e=>({name:e.name,kind:e.isDirectory()?'directory':'file'})));}else if(input.action==='filesystem.exists'){try{fs.accessSync(inside(p.path));output(true)}catch{output(false)}}else if(input.action==='filesystem.write'){if(typeof p.content!=='string'||Buffer.byteLength(p.content,'utf8')>max)throw new Error('The requested file content is invalid or too large.');const target=inside(p.path);const existed=fs.existsSync(target);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,p.content,'utf8');output('Wrote '+Buffer.byteLength(p.content,'utf8')+' bytes.',{path:p.path,kind:existed?'modified':'created'});}else if(input.action==='shell.exec'){if(typeof p.command!=='string'||!Array.isArray(p.args)||p.args.some(a=>typeof a!=='string'))throw new Error('shell.exec parameters are invalid.');const child=cp.spawnSync(p.command,p.args,{cwd:inside(p.cwd||'.'),encoding:'utf8',timeout:${DESKTOP_RUNTIME_LIMITS.sandboxMaxShellTimeoutMs},windowsHide:true});const stdout=String(child.stdout||'');const stderr=String(child.stderr||'');output({stdout,stderr,exitCode:typeof child.status==='number'?child.status:null,timedOut:Boolean(child.error&&child.error.code==='ETIMEDOUT'),truncated:false});}else throw new Error('Unsupported sandbox action.');}catch(error){process.stdout.write(JSON.stringify({ok:false,error:error instanceof Error?error.message:'Sandbox execution failed.'}))}`;
