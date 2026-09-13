import type { SandboxHealthSnapshot, SandboxSettings } from '../../contracts/ipc/v1/settings.js';
import type { GuestDependencyReport, GuestDependencyQuery } from '../dependencies/native-dependency-service.js';
import type { VmRuntimeStatus } from './vm-types.js';
import { SANDBOX_ALLOWLIST_UNAVAILABLE_MESSAGE } from './vm-runtime-adapter.js';

export interface VmHealthServiceDependencies {
  getSettings: () => Promise<SandboxSettings>;
  inspectRuntime: (distribution: string) => Promise<VmRuntimeStatus>;
  inspectDependencies: (options: GuestDependencyQuery) => Promise<GuestDependencyReport>;
  repairDependencies: (options: GuestDependencyQuery) => Promise<GuestDependencyReport>;
  repairRuntime?: () => Promise<VmRuntimeStatus>;
}

/** Combines runtime and manifest health for the VM settings and diagnostics UI. */
export class VmHealthService {
  constructor(private readonly dependencies: VmHealthServiceDependencies) {}

  async health(): Promise<SandboxHealthSnapshot> {
    const settings = await this.dependencies.getSettings();
    const inspectedRuntime = await this.dependencies.inspectRuntime(settings.distribution);
    const runtime = settings.networkPolicy === 'allowlist'
      ? { ...inspectedRuntime, available: false, reason: SANDBOX_ALLOWLIST_UNAVAILABLE_MESSAGE }
      : inspectedRuntime;
    const dependencies = inspectedRuntime.available
      ? await this.dependencies.inspectDependencies(queryFor(settings))
      : unavailableDependencies(settings);
    return snapshot(settings, runtime, dependencies);
  }

  async repair(): Promise<SandboxHealthSnapshot> {
    const settings = await this.dependencies.getSettings();
    const repairedRuntime = this.dependencies.repairRuntime === undefined ? await this.dependencies.inspectRuntime(settings.distribution) : await this.dependencies.repairRuntime();
    const runtime = settings.networkPolicy === 'allowlist'
      ? { ...repairedRuntime, available: false, reason: SANDBOX_ALLOWLIST_UNAVAILABLE_MESSAGE }
      : repairedRuntime;
    const dependencies = repairedRuntime.available
      ? await this.dependencies.repairDependencies(queryFor(settings))
      : unavailableDependencies(settings);
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
