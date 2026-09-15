import type { SandboxSettings } from '../../contracts/ipc/v1/settings.js';
import type { VmSandboxOptions } from './vm-types.js';

export interface VmResourcePaths {
  readonly guestRunnerPath: string;
}

/** Maps validated Desktop settings to the single sandbox runtime configuration. */
export function resolveVmSandboxOptions(settings: SandboxSettings, resources: VmResourcePaths): VmSandboxOptions {
  return {
    runtime: settings.runtime,
    distribution: settings.distribution,
    profile: settings.profile,
    networkPolicy: settings.networkPolicy,
    workspaceAccess: settings.workspaceAccess,
    memoryMb: settings.memoryMb,
    cpuCores: settings.cpuCores,
    pidsLimit: settings.pidsLimit,
    diskMb: settings.diskMb,
    maxConcurrentEnvironments: settings.maxConcurrentEnvironments,
    maxConcurrentOperations: settings.maxConcurrentOperations,
    idleTimeoutMinutes: settings.idleTimeoutMinutes,
    guestRunnerPath: resources.guestRunnerPath,
  };
}
