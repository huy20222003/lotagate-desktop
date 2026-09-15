import { realpath } from 'node:fs/promises';
import type { FileChangeDiff } from '../../contracts/ipc/v1/workspace.js';
import { VmEnvironmentManager } from './vm-environment-manager.js';
import { VmScheduler } from './vm-scheduler.js';
import { createVmRuntimeAdapter, SandboxUnavailableError, type VmRuntimeAdapter } from './vm-runtime-adapter.js';
import type { VmSandboxOptions, VmRuntimeStartInput, VmEnvironmentIdentity } from './vm-types.js';

export interface SandboxExecutionInput {
  readonly root: string;
  readonly action: string;
  readonly params: Record<string, unknown>;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
}

export interface SandboxExecutionResult {
  readonly result: unknown;
  readonly environmentId?: string;
  readonly fileChange?: FileChangeDiff;
  readonly fileChangeKind?: 'created' | 'modified';
}

export interface SandboxExecutionProvider {
  execute(input: SandboxExecutionInput): Promise<SandboxExecutionResult>;
  closeWorkspace?(root: string): Promise<void>;
}

type VmSandboxPreparation = (options: VmSandboxOptions) => Promise<void>;

/**
 * Desktop-owned VM provider. A warm guest is shared by compatible workspace
 * environments, while the scheduler serializes mutations per environment and
 * bounds total guest operations.
 */
export class VmSandboxExecutionProvider implements SandboxExecutionProvider {
  private readonly manager: VmEnvironmentManager;
  private readonly scheduler = new VmScheduler();

  constructor(private readonly getOptions: () => VmSandboxOptions | Promise<VmSandboxOptions>, private readonly runtime: VmRuntimeAdapter = createVmRuntimeAdapter(), private readonly prepare?: VmSandboxPreparation) {
    this.manager = new VmEnvironmentManager(this.runtime);
  }

  async execute(input: SandboxExecutionInput): Promise<SandboxExecutionResult> {
    const options = await this.getOptions();
    if (options.runtime === 'disabled') throw new SandboxUnavailableError('The Desktop VM sandbox is disabled in Settings.');
    await this.prepare?.(options);
    const root = await realpath(input.root);
    const identity = createIdentity(root, options);
    const startInput = createStartInput(root, options);
    const result = await this.scheduler.run(identity.key, options.maxConcurrentOperations, input.signal, () => this.manager.execute(identity, startInput, {
      action: input.action,
      params: options.workspaceAccess === 'read-only' && input.action === 'filesystem.write'
        ? { ...input.params, __readOnly: true }
        : input.params,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
      ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
    }, options.maxConcurrentEnvironments));
    return {
      result: result.result,
      ...(result.environmentId === undefined ? {} : { environmentId: result.environmentId }),
      ...(result.fileChange === undefined ? {} : {
        fileChange: boundedFileChange(result.fileChange.path),
        fileChangeKind: result.fileChange.kind,
      }),
    };
  }

  async inspect(): Promise<Awaited<ReturnType<import('./vm-types.js').VmRuntimeAdapter['inspect']>>> {
    const options = await this.getOptions();
    if (options.runtime === 'disabled') return { runtime: 'unsupported', available: false, distribution: options.distribution, reason: 'VM sandbox is disabled in Settings.' };
    const result = await this.runtime.inspect(options.distribution);
    return result;
  }

  closeAll(): Promise<void> { return this.manager.closeAll(); }

  async closeWorkspace(root: string): Promise<void> {
    await this.manager.closeWorkspace(await realpath(root).catch(() => root));
  }
}

function createIdentity(root: string, options: VmSandboxOptions): VmEnvironmentIdentity {
  return {
    key: [root, options.distribution, options.profile, options.networkPolicy, options.workspaceAccess, options.memoryMb, options.cpuCores, options.pidsLimit, options.diskMb].join('\u0000'),
    root,
    distribution: options.distribution,
    profile: options.profile,
    networkPolicy: options.networkPolicy,
    workspaceAccess: options.workspaceAccess,
  };
}

function createStartInput(root: string, options: VmSandboxOptions): VmRuntimeStartInput {
  return {
    root,
    distribution: options.distribution,
    profile: options.profile,
    networkPolicy: options.networkPolicy,
    workspaceAccess: options.workspaceAccess,
    memoryMb: options.memoryMb,
    cpuCores: options.cpuCores,
    pidsLimit: options.pidsLimit,
    diskMb: options.diskMb,
    guestRunnerPath: options.guestRunnerPath,
    idleTimeoutMinutes: options.idleTimeoutMinutes,
  };
}

function boundedFileChange(path: string): FileChangeDiff {
  const normalized = path.replaceAll('\\', '/').replace(/^\/workspace\/?/u, '');
  return { path: normalized || '.', lines: [], additions: 0, deletions: 0, truncated: true };
}

export { SandboxUnavailableError } from './vm-runtime-adapter.js';
