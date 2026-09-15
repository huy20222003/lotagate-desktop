import type { SandboxHealthSnapshot, SandboxSettings } from '../../contracts/ipc/v1/settings.js';
import type { GuestDependencyReport, GuestDependencyQuery } from '../dependencies/native-dependency-service.js';
import type { VmRuntimeStatus } from './vm-types.js';

export interface VmHealthServiceDependencies {
  getSettings: () => Promise<SandboxSettings>;
  inspectRuntime: (distribution: string) => Promise<VmRuntimeStatus>;
  inspectDependencies: (options: GuestDependencyQuery) => Promise<GuestDependencyReport>;
  repairDependencies: (options: GuestDependencyQuery) => Promise<GuestDependencyReport>;
  repairRuntime?: () => Promise<VmRuntimeStatus>;
}

/** Combines runtime and manifest health for the sandbox settings and diagnostics UI. */
export class VmHealthService {
  private repairOperation: Promise<SandboxHealthSnapshot> | undefined;

  constructor(private readonly dependencies: VmHealthServiceDependencies) {}

  async health(): Promise<SandboxHealthSnapshot> {
    const settings = await this.dependencies.getSettings();
    const runtime = await this.dependencies.inspectRuntime(settings.distribution);
    const dependencies = runtime.available
      ? await this.dependencies.inspectDependencies(queryFor(settings))
      : unavailableDependencies(settings);
    return snapshot(settings, runtime, dependencies);
  }

  repair(): Promise<SandboxHealthSnapshot> {
    if (this.repairOperation !== undefined) return this.repairOperation;
    const operation = this.repairExclusive();
    this.repairOperation = operation;
    void operation.then(() => {
      if (this.repairOperation === operation) this.repairOperation = undefined;
    }, () => {
      if (this.repairOperation === operation) this.repairOperation = undefined;
    });
    return operation;
  }

  private async repairExclusive(): Promise<SandboxHealthSnapshot> {
    const settings = await this.dependencies.getSettings();
    if (settings.runtime === 'disabled') {
      return snapshot(settings, await this.dependencies.inspectRuntime(settings.distribution), unavailableDependencies(settings));
    }
    const runtimeHasRepair = this.dependencies.repairRuntime !== undefined;
    const repairedRuntime = runtimeHasRepair ? await this.dependencies.repairRuntime!() : await this.dependencies.inspectRuntime(settings.distribution);
    // Host-native backends (bubblewrap and Seatbelt) have no separate runtime
    // repair command. Their package repair owner must still get a chance to
    // install the missing manifest entries before the final health probe.
    const dependencies = (!runtimeHasRepair || repairedRuntime.available)
      ? await this.dependencies.repairDependencies(queryFor(settings))
      : unavailableDependencies(settings);
    // Runtime repair may only make the WSL host usable; importing the shared
    // guest image is owned by the dependency service. Probe the configured
    // runtime again after that import/install step so the UI does not report
    // the transient post-repair status.
    const runtime = await this.dependencies.inspectRuntime(settings.distribution);
    return snapshot(settings, runtime, dependencies);
  }
}

function queryFor(settings: SandboxSettings): GuestDependencyQuery {
  return { runtime: settings.runtime, distribution: settings.distribution, profile: settings.profile };
}

function healthState(settings: SandboxSettings, runtime: VmRuntimeStatus, dependencies: GuestDependencyReport): SandboxHealthSnapshot['state'] {
  if (settings.runtime === 'disabled') return 'disabled';
  if (!runtime.available || !dependencies.available) return 'unavailable';
  if (dependencies.missing.length > 0 || dependencies.manual.length > 0 || dependencies.failed.length > 0) return 'degraded';
  return 'ready';
}

function snapshot(settings: SandboxSettings, runtime: VmRuntimeStatus, dependencies: GuestDependencyReport): SandboxHealthSnapshot {
  return {
    state: healthState(settings, runtime, dependencies),
    runtime,
    dependencies: {
      profile: dependencies.profile,
      available: dependencies.available,
      statuses: dependencies.statuses.map(status => ({ ...status })),
      installed: [...dependencies.installed],
      missing: [...dependencies.missing],
      manual: [...dependencies.manual],
      failed: [...dependencies.failed],
    },
    checkedAt: new Date().toISOString(),
  };
}

function unavailableDependencies(settings: SandboxSettings): GuestDependencyReport {
  const runtime = settings.runtime === 'auto' || settings.runtime === 'wsl2' ? 'wsl2' : process.platform === 'darwin' ? 'seatbelt' : 'bubblewrap';
  return {
    runtime,
    distribution: settings.distribution,
    profile: settings.profile,
    available: false,
    statuses: [],
    installed: [],
    missing: [],
    manual: [],
    failed: [],
  };
}
