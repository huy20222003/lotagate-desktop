import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, normalize, resolve } from 'node:path';
import { DESKTOP_RUNTIME_LIMITS } from '../../contracts/runtime-limits.js';
import { runBoundedCommand } from '../process/bounded-command.js';
import { commandWorks } from '../process/command-availability.js';
import { VmGuestBridge } from './vm-guest-bridge.js';
import type { VmRuntimeAdapter, VmRuntimeEnvironment, VmRuntimeExecuteInput, VmRuntimeExecutionResult, VmRuntimeStartInput, VmRuntimeStatus } from './vm-types.js';
import { VmGuestProcessError } from './vm-guest-bridge.js';
import { vmProfile } from './vm-image-catalog.js';
import { WindowsWsl2PrerequisiteService } from './windows-wsl2-prerequisite-service.js';

export type { VmRuntimeAdapter, VmRuntimeEnvironment, VmRuntimeExecuteInput, VmRuntimeExecutionResult, VmRuntimeStartInput, VmRuntimeStatus } from './vm-types.js';

export const SANDBOX_ALLOWLIST_UNAVAILABLE_MESSAGE = 'The sandbox network allowlist requires a configured guest proxy.';

/**
 * WSL2 is the Windows VM backend. The guest process is started once for an
 * environment and kept behind an authenticated JSONL bridge until it becomes
 * idle or the process exits.
 */
export class Wsl2RuntimeAdapter implements VmRuntimeAdapter {
  constructor(private readonly prerequisites = new WindowsWsl2PrerequisiteService()) {}

  async inspect(distribution: string): Promise<VmRuntimeStatus> {
    const prerequisites = await this.prerequisites.inspect();
    if (!prerequisites.available) return { runtime: 'wsl2', available: false, distribution, ...prerequisiteFields(prerequisites) };
    try {
      await runBoundedCommand('wsl.exe', ['--distribution', distribution, '--user', 'root', '--exec', 'bash', '-lc', 'command -v -- python3 >/dev/null && command -v -- bwrap >/dev/null && printf lotagate-vm-ready'], { maxOutputBytes: 16 * 1024, timeoutMs: 10_000 });
      return { runtime: 'wsl2', available: true, distribution, resourceQuota: 'process' };
    } catch (error) {
      return { runtime: 'wsl2', available: false, distribution, reason: redact(error instanceof Error ? error.message : 'WSL2 is unavailable.') };
    }
  }

  async repair(): Promise<VmRuntimeStatus> {
    const prerequisites = await this.prerequisites.repair();
    if (!prerequisites.available) return { runtime: 'wsl2', available: false, distribution: '', ...prerequisiteFields(prerequisites) };
    try {
      // A failed guest probe can leave the WSL utility VM stuck while the
      // Windows features themselves remain healthy. Reset that host runtime
      // before the health service probes the configured distribution again.
      await runBoundedCommand('wsl.exe', ['--shutdown'], { maxOutputBytes: 64 * 1024, timeoutMs: 15_000 });
      return { runtime: 'wsl2', available: true, distribution: '', ...prerequisiteFields(prerequisites) };
    } catch (error) {
      return { runtime: 'wsl2', available: false, distribution: '', reason: redact(error instanceof Error ? error.message : 'WSL2 could not be restarted.'), ...prerequisiteFields(prerequisites) };
    }
  }

  async ensureAvailable(automatic: boolean): Promise<VmRuntimeStatus> {
    const current = await this.inspect('');
    if (!automatic || current.available) return current;
    return this.repair();
  }

  async start(input: VmRuntimeStartInput): Promise<VmRuntimeEnvironment> {
    const root = await realpath(input.root);
    const rootInfo = await stat(root);
    if (!rootInfo.isDirectory()) throw new SandboxUnavailableError('The VM workspace root is not a directory.');
    const runner = await realpath(input.guestRunnerPath);
    const documentRunner = input.guestDocumentRunnerPath === undefined ? undefined : await realpath(input.guestDocumentRunnerPath);
    const documentResources = input.guestDocumentResourcesPath === undefined ? undefined : await realpath(input.guestDocumentResourcesPath);
    const authToken = randomUUID();
    const args = createWslArguments(input, toWslPath(root), toWslPath(runner), authToken, documentRunner === undefined ? undefined : toWslPath(documentRunner), documentResources === undefined ? undefined : toWslPath(documentResources));
    const child = spawn('wsl.exe', args, { shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    const bridge = new VmGuestBridge(child, authToken);
    try {
      await bridge.execute({ action: 'health', params: {}, timeoutMs: 10_000, ...(input.signal === undefined ? {} : { signal: input.signal }) });
    } catch (error) {
      await bridge.close();
      if (input.signal?.aborted === true) throw new Error('VM sandbox execution was cancelled.');
      throw classifyRuntimeFailure(error, 'WSL2', input.distribution);
    }
    return new LocalRuntimeEnvironment(bridge, input, '/workspace');
  }
}

/** Linux uses the same bubblewrap policy as the WSL2 guest, without a second OS. */
export class LinuxBubblewrapRuntimeAdapter implements VmRuntimeAdapter {
  async inspect(distribution: string): Promise<VmRuntimeStatus> {
    try {
      await runBoundedCommand('bwrap', bwrapHealthArguments(), { maxOutputBytes: 16 * 1024, timeoutMs: 10_000 });
      return { runtime: 'bubblewrap', available: true, distribution, resourceQuota: await linuxResourceQuota() };
    } catch (error) {
      return { runtime: 'bubblewrap', available: false, distribution, reason: redact(error instanceof Error ? error.message : 'Bubblewrap is unavailable.') };
    }
  }

  async start(input: VmRuntimeStartInput): Promise<VmRuntimeEnvironment> {
    const root = await realpath(input.root);
    const rootInfo = await stat(root);
    if (!rootInfo.isDirectory()) throw new SandboxUnavailableError('The sandbox workspace root is not a directory.');
    const runner = await realpath(input.guestRunnerPath);
    const documentRunner = input.guestDocumentRunnerPath === undefined ? undefined : await realpath(input.guestDocumentRunnerPath);
    const documentResources = input.guestDocumentResourcesPath === undefined ? undefined : await realpath(input.guestDocumentResourcesPath);
    const authToken = randomUUID();
    const args = createBwrapArguments(input, root, runner, authToken, documentRunner, documentResources);
    const launch = await linuxLaunch(input, args);
    const child = spawn(launch.command, launch.args, { shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
    const bridge = new VmGuestBridge(child, authToken);
    try {
      await bridge.execute({ action: 'health', params: {}, timeoutMs: 10_000, ...(input.signal === undefined ? {} : { signal: input.signal }) });
    } catch (error) {
      await bridge.close();
      if (input.signal?.aborted === true) throw new Error('Sandbox execution was cancelled.');
      throw classifyRuntimeFailure(error, 'bubblewrap', input.distribution);
    }
    return new LocalRuntimeEnvironment(bridge, input, '/workspace');
  }
}

/** macOS uses the OS Seatbelt policy; the terminal and Computer Use remain host-native. */
export class MacSeatbeltRuntimeAdapter implements VmRuntimeAdapter {
  async inspect(distribution: string): Promise<VmRuntimeStatus> {
    try {
      await runBoundedCommand('sandbox-exec', ['-p', '(version 1) (allow default)', '/usr/bin/true'], { maxOutputBytes: 16 * 1024, timeoutMs: 10_000 });
      return { runtime: 'seatbelt', available: true, distribution, resourceQuota: 'process' };
    } catch (error) {
      return { runtime: 'seatbelt', available: false, distribution, reason: redact(error instanceof Error ? error.message : 'macOS Seatbelt is unavailable.') };
    }
  }

  async start(input: VmRuntimeStartInput): Promise<VmRuntimeEnvironment> {
    const root = await realpath(input.root);
    const rootInfo = await stat(root);
    if (!rootInfo.isDirectory()) throw new SandboxUnavailableError('The sandbox workspace root is not a directory.');
    const runner = await realpath(input.guestRunnerPath);
    const documentRunner = input.guestDocumentRunnerPath === undefined ? undefined : await realpath(input.guestDocumentRunnerPath);
    const documentResources = input.guestDocumentResourcesPath === undefined ? undefined : await realpath(input.guestDocumentResourcesPath);
    const profileDirectory = await mkdtemp(join(tmpdir(), 'lotagate-seatbelt-'));
    const profilePath = join(profileDirectory, 'profile.sb');
    await writeFile(profilePath, createSeatbeltProfile(input, root, tmpdir()), { encoding: 'utf8', mode: 0o600 });
    const authToken = randomUUID();
    const args = ['-f', profilePath, 'python3', runner, '--server', '--auth-token', authToken];
    const child = spawn('sandbox-exec', args, { shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
    const bridge = new VmGuestBridge(child, authToken);
    try {
      await bridge.execute({ action: 'health', params: {}, timeoutMs: 10_000, ...(input.signal === undefined ? {} : { signal: input.signal }) });
    } catch (error) {
      await bridge.close();
      await rm(profileDirectory, { recursive: true, force: true });
      if (input.signal?.aborted === true) throw new Error('Sandbox execution was cancelled.');
      throw classifyRuntimeFailure(error, 'seatbelt', input.distribution);
    }
    const runtimeInput: VmRuntimeStartInput = {
      ...input,
      root,
      guestRunnerPath: runner,
      ...(documentRunner === undefined ? {} : { guestDocumentRunnerPath: documentRunner }),
      ...(documentResources === undefined ? {} : { guestDocumentResourcesPath: documentResources }),
    };
    return new LocalRuntimeEnvironment(bridge, runtimeInput, root, () => rm(profileDirectory, { recursive: true, force: true }));
  }
}

class LocalRuntimeEnvironment implements VmRuntimeEnvironment {
  readonly id = randomUUID();

  constructor(private readonly bridge: VmGuestBridge, private readonly input: VmRuntimeStartInput, private readonly guestRoot: string, private readonly cleanup?: () => Promise<void>) {}

  execute(input: VmRuntimeExecuteInput): Promise<VmRuntimeExecutionResult> {
    const profile = vmProfile(this.input.profile);
    const hasDocumentTools = profile.guestCapabilities.includes('document');
    const params = {
      ...input.params,
      __lotagateRuntime: {
        root: this.guestRoot,
        workspaceAccess: this.input.workspaceAccess,
        memoryMb: this.input.memoryMb,
        cpuCores: this.input.cpuCores,
        pidsLimit: this.input.pidsLimit,
        diskMb: this.input.diskMb,
        maxOutputBytes: DESKTOP_RUNTIME_LIMITS.cliJsonlLineBytes,
        ...(hasDocumentTools && this.input.guestDocumentRunnerPath !== undefined ? { documentRunner: this.guestRoot === '/workspace' ? '/opt/lotagate/sandbox/document-runner.mjs' : this.input.guestDocumentRunnerPath } : {}),
        ...(hasDocumentTools && this.input.guestDocumentResourcesPath !== undefined ? { documentResources: this.guestRoot === '/workspace' ? '/opt/lotagate/document-use' : this.input.guestDocumentResourcesPath } : {}),
        ...(this.guestRoot === '/workspace' ? {} : { nodeExecutable: process.execPath, ...(process.versions.electron === undefined ? {} : { nodeEnvironment: { ELECTRON_RUN_AS_NODE: '1' } }) }),
      },
    };
    return this.bridge.execute({ ...input, timeoutMs: boundedSandboxTimeout(input.timeoutMs), params }).then(result => ({ ...result, environmentId: this.id }));
  }

  async close(): Promise<void> {
    await this.bridge.close();
    await this.cleanup?.();
  }
}

export function createWslArguments(input: VmRuntimeStartInput, root: string, runner: string, authToken: string, documentRunner: string | undefined, documentResources: string | undefined): string[] {
  return ['--distribution', input.distribution, '--user', 'root', '--exec', ...createBwrapArguments(input, root, runner, authToken, documentRunner, documentResources)];
}

export function createBwrapArguments(input: VmRuntimeStartInput, root: string, runner: string, authToken: string, documentRunner: string | undefined, documentResources: string | undefined): string[] {
  if (input.networkPolicy === 'allowlist') throw new SandboxUnavailableError(SANDBOX_ALLOWLIST_UNAVAILABLE_MESSAGE);
  const profile = vmProfile(input.profile);
  const hasDocumentTools = profile.guestCapabilities.includes('document');
  const command: string[] = [
    '--ro-bind', '/', '/',
    '--dir', '/workspace',
    input.workspaceAccess === 'read-only' ? '--ro-bind' : '--bind', root, '/workspace',
    '--dir', '/opt/lotagate',
    '--dir', '/opt/lotagate/sandbox',
    '--ro-bind', runner, '/opt/lotagate/sandbox/guest-runner.py',
    '--dev', '/dev',
    '--proc', '/proc',
    '--chdir', '/workspace',
    '--die-with-parent',
    '--new-session',
    '--unshare-pid',
    '--cap-drop', 'ALL',
  ];
  if (hasDocumentTools && documentRunner !== undefined) command.push('--ro-bind', documentRunner, '/opt/lotagate/sandbox/document-runner.mjs');
  if (hasDocumentTools && documentResources !== undefined) command.push('--dir', '/opt/lotagate/document-use', '--ro-bind', documentResources, '/opt/lotagate/document-use');
  command.push('--tmpfs', '/home', '--tmpfs', '/root', '--tmpfs', '/mnt', '--tmpfs', '/tmp');
  if (input.networkPolicy === 'none') command.push('--unshare-net');
  command.push('--', 'python3', '/opt/lotagate/sandbox/guest-runner.py', '--server', '--auth-token', authToken);
  return ['bwrap', ...command];
}

function classifyRuntimeFailure(error: unknown, runtime: string, distribution: string): Error {
  const message = error instanceof Error ? error.message : `${runtime} guest execution failed.`;
  if (error instanceof VmGuestProcessError || /not found|cannot find|distribution|wsl|bwrap|sandbox-exec|python3|access is denied|no such file/iu.test(message)) return new SandboxUnavailableError(`The ${runtime} sandbox runtime is unavailable for distribution "${distribution}".`);
  return new Error(redact(message));
}

export class SandboxUnavailableError extends Error {
  constructor(message: string) { super(message); this.name = 'SandboxUnavailableError'; }
}

/** Explicit non-support status; never silently falls back to a host shell. */
export class UnsupportedVmRuntimeAdapter implements VmRuntimeAdapter {
  constructor(private readonly platform = process.platform) {}

  inspect(distribution: string): Promise<VmRuntimeStatus> {
    return Promise.resolve({ runtime: 'unsupported', available: false, distribution, reason: `No sandbox backend is bundled for ${this.platform}.` });
  }

  start(_input: VmRuntimeStartInput): Promise<VmRuntimeEnvironment> {
    return Promise.reject(new SandboxUnavailableError(`No sandbox backend is bundled for ${this.platform}.`));
  }
}

export function createVmRuntimeAdapter(): VmRuntimeAdapter {
  if (process.platform === 'win32') return new Wsl2RuntimeAdapter();
  if (process.platform === 'linux') return new LinuxBubblewrapRuntimeAdapter();
  if (process.platform === 'darwin') return new MacSeatbeltRuntimeAdapter();
  return new UnsupportedVmRuntimeAdapter();
}

function bwrapHealthArguments(): string[] {
  return ['--ro-bind', '/', '/', '--dev', '/dev', '--proc', '/proc', '--die-with-parent', '--new-session', '--unshare-pid', '--cap-drop', 'ALL', '--', 'python3', '-c', "import shutil; raise SystemExit(0 if shutil.which('python3') else 1)"];
}

async function linuxResourceQuota(): Promise<'cgroup' | 'process'> {
  return await commandWorks('systemd-run', ['--user', '--scope', '--quiet', '--wait', '--collect', '-p', 'MemoryMax=128M', '-p', 'TasksMax=16', '-p', 'CPUQuota=100%', '--', 'true']) ? 'cgroup' : 'process';
}

async function linuxLaunch(input: VmRuntimeStartInput, bwrapArguments: readonly string[]): Promise<{ readonly command: string; readonly args: readonly string[] }> {
  if (await linuxResourceQuota() !== 'cgroup') return { command: 'bwrap', args: bwrapArguments };
  return {
    command: 'systemd-run',
    args: ['--user', '--scope', '--quiet', '--wait', '--collect', '-p', `MemoryMax=${String(Math.max(128, Math.trunc(input.memoryMb)))}M`, '-p', `TasksMax=${String(Math.max(16, Math.trunc(input.pidsLimit)))}`, '-p', `CPUQuota=${String(Math.max(1, Math.ceil(input.cpuCores * 100)))}%`, '--', ...bwrapArguments],
  };
}

export function createSeatbeltProfile(input: Pick<VmRuntimeStartInput, 'networkPolicy' | 'workspaceAccess'>, workspace: string, temporaryDirectory: string): string {
  if (input.networkPolicy === 'allowlist') throw new SandboxUnavailableError(SANDBOX_ALLOWLIST_UNAVAILABLE_MESSAGE);
  const writablePaths = [
    '/tmp',
    temporaryDirectory,
    ...(input.workspaceAccess === 'read-write' ? [workspace] : []),
  ];
  const network = input.networkPolicy === 'full' ? '(allow network*)' : '(deny network*)';
  return ['(version 1)', '(deny default)', '(import "system.sb")', '(allow file-read*)', '(allow process*)', `(allow file-write* ${writablePaths.map(path => `(subpath ${seatbeltPath(path)})`).join(' ')})`, network].join('\n');
}

function seatbeltPath(value: string): string {
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
}

export function boundedSandboxTimeout(timeoutMs: number | undefined): number {
  if (timeoutMs === undefined || !Number.isFinite(timeoutMs)) return DESKTOP_RUNTIME_LIMITS.defaultExecutionTimeoutMs;
  return Math.min(Math.max(Math.trunc(timeoutMs), DESKTOP_RUNTIME_LIMITS.minExecutionTimeoutMs), DESKTOP_RUNTIME_LIMITS.sandboxMaxExecutionTimeoutMs);
}

export function toWslPath(value: string): string {
  const normalized = normalize(resolve(value));
  const drive = /^([A-Za-z]):[\\/](.*)$/u.exec(normalized);
  if (drive !== null) return `/mnt/${drive[1]!.toLowerCase()}/${drive[2]!.replaceAll('\\', '/')}`;
  if (isAbsolute(normalized) && process.platform !== 'win32') return normalized;
  throw new SandboxUnavailableError('The VM supports only local drive workspace paths on Windows.');
}

function redact(value: string): string {
  return value.replace(/Bearer\s+[^\s]+/giu, 'Bearer [REDACTED]').replace(/sk-[A-Za-z0-9_-]{8,}/gu, '[REDACTED]');
}

function prerequisiteFields(status: { readonly restartRequired: boolean; readonly adminRequired: boolean; readonly reason?: string }): Pick<VmRuntimeStatus, 'restartRequired' | 'adminRequired' | 'reason'> {
  return { restartRequired: status.restartRequired, adminRequired: status.adminRequired, ...(status.reason === undefined ? {} : { reason: status.reason }) };
}
