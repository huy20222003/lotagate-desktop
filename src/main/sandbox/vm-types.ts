import type { SandboxNetworkPolicy, SandboxRuntime, SandboxWorkspaceAccess } from '../../contracts/ipc/v1/settings.js';

export type VmEnvironmentProfile = 'general';
export type VmFileChangeKind = 'created' | 'modified';

export interface VmRuntimeStartInput {
  readonly root: string;
  readonly distribution: string;
  readonly profile: VmEnvironmentProfile;
  readonly networkPolicy: SandboxNetworkPolicy;
  readonly workspaceAccess: SandboxWorkspaceAccess;
  readonly memoryMb: number;
  readonly cpuCores: number;
  readonly pidsLimit: number;
  readonly diskMb: number;
  readonly guestRunnerPath: string;
  readonly idleTimeoutMinutes: number;
  readonly signal?: AbortSignal;
}

export interface VmRuntimeExecuteInput {
  readonly action: string;
  readonly params: Record<string, unknown>;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
}

export interface VmRuntimeExecutionResult {
  readonly result: unknown;
  readonly environmentId?: string;
  readonly fileChange?: { readonly path: string; readonly kind: VmFileChangeKind };
}

export interface VmRuntimeEnvironment {
  readonly id?: string;
  execute(input: VmRuntimeExecuteInput): Promise<VmRuntimeExecutionResult>;
  close(): Promise<void>;
}

export interface VmRuntimeStatus {
  readonly runtime: 'wsl2' | 'bubblewrap' | 'seatbelt' | 'unsupported';
  readonly available: boolean;
  readonly distribution: string;
  readonly restartRequired?: boolean;
  readonly adminRequired?: boolean;
  readonly isolation?: 'vm' | 'host-sandbox';
  readonly resourceQuota?: 'cgroup' | 'process';
  readonly reason?: string;
}

export interface VmRuntimeAdapter {
  inspect(distribution: string): Promise<VmRuntimeStatus>;
  start(input: VmRuntimeStartInput): Promise<VmRuntimeEnvironment>;
  repair?(distribution?: string): Promise<VmRuntimeStatus>;
  ensureAvailable?(distribution: string, automatic: boolean): Promise<VmRuntimeStatus>;
}

export interface VmSandboxOptions {
  readonly runtime: SandboxRuntime;
  readonly distribution: string;
  readonly profile: VmEnvironmentProfile;
  readonly networkPolicy: SandboxNetworkPolicy;
  readonly workspaceAccess: SandboxWorkspaceAccess;
  readonly memoryMb: number;
  readonly cpuCores: number;
  readonly pidsLimit: number;
  readonly diskMb: number;
  readonly maxConcurrentEnvironments: number;
  readonly maxConcurrentOperations: number;
  readonly idleTimeoutMinutes: number;
  readonly guestRunnerPath: string;
}

export interface VmEnvironmentIdentity {
  readonly key: string;
  readonly root: string;
  readonly distribution: string;
  readonly profile: VmEnvironmentProfile;
  readonly networkPolicy: SandboxNetworkPolicy;
  readonly workspaceAccess: SandboxWorkspaceAccess;
}
