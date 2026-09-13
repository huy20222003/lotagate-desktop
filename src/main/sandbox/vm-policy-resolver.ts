import type { SandboxSettings } from '../../contracts/ipc/v1/settings.js';
import type { VmSandboxOptions } from './vm-types.js';

export interface VmResourcePaths {
  readonly guestRunnerPath: string;
  readonly guestDocumentRunnerPath: string;
  readonly guestDocumentResourcesPath: string;
}

/** Maps validated Desktop settings to the single VM runtime configuration. */
export function resolveVmSandboxOptions(settings: SandboxSettings, resources: VmResourcePaths): VmSandboxOptions {
  return {
    runtime: settings.runtime,
    distribution: settings.distribution,
    profile: settings.profile,
    networkPolicy: settings.networkPolicy,
    allowedDomains: settings.allowedDomains,
    workspaceAccess: settings.workspaceAccess,
    memoryMb: settings.memoryMb,
    cpuCores: settings.cpuCores,
    pidsLimit: settings.pidsLimit,
    diskMb: settings.diskMb,
    maxConcurrentEnvironments: settings.maxConcurrentEnvironments,
    maxConcurrentOperations: settings.maxConcurrentOperations,
    idleTimeoutMinutes: settings.idleTimeoutMinutes,
    guestRunnerPath: resources.guestRunnerPath,
    guestDocumentRunnerPath: resources.guestDocumentRunnerPath,
    guestDocumentResourcesPath: resources.guestDocumentResourcesPath,
  };
}
