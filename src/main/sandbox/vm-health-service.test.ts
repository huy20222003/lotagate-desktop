import { describe, expect, it, vi } from 'vitest';
import type { SandboxSettings } from '../../contracts/ipc/v1/settings.js';
import { SANDBOX_DEFAULTS } from '../../contracts/ipc/v1/settings.js';
import type { GuestDependencyReport } from '../dependencies/native-dependency-service.js';
import { VmHealthService } from './vm-health-service.js';

const settings: SandboxSettings = { ...SANDBOX_DEFAULTS };

describe('VmHealthService', () => {
  it('reports a ready runtime when the selected guest profile is healthy', async () => {
    const service = createService({ available: true }, { available: true });
    await expect(service.health()).resolves.toMatchObject({ state: 'ready', runtime: { distribution: settings.distribution }, dependencies: { profile: settings.profile } });
  });

  it('distinguishes missing guest dependencies from an unavailable runtime', async () => {
    await expect(createService({ available: true }, { available: true, missing: ['sandbox.wsl2.base'] }).health()).resolves.toMatchObject({ state: 'degraded' });
    await expect(createService({ available: false, reason: 'bwrap is missing' }, { available: true }).health()).resolves.toMatchObject({ state: 'unavailable', runtime: { reason: 'bwrap is missing' } });
  });

  it('does not probe or install guest dependencies when the runtime is unavailable', async () => {
    const inspectDependencies = vi.fn(async () => healthyDependencies());
    const repairDependencies = vi.fn(async () => healthyDependencies());
    const service = new VmHealthService({
      getSettings: async () => settings,
      inspectRuntime: async () => ({ runtime: 'wsl2', available: false, distribution: settings.distribution }),
      repairRuntime: async () => ({ runtime: 'wsl2', available: false, distribution: settings.distribution }),
      inspectDependencies,
      repairDependencies,
    });
    await service.health();
    await service.repair();
    expect(inspectDependencies).not.toHaveBeenCalled();
    expect(repairDependencies).not.toHaveBeenCalled();
  });

  it('repairs host-native sandbox dependencies before the final runtime probe', async () => {
    let available = false;
    const inspectRuntime = vi.fn(async () => ({ runtime: 'bubblewrap' as const, available, distribution: settings.distribution, isolation: 'host-sandbox' as const }));
    const repairDependencies = vi.fn(async () => {
      available = true;
      return { ...healthyDependencies(), runtime: 'bubblewrap' as const, available: true };
    });
    const service = new VmHealthService({ getSettings: async () => settings, inspectRuntime, inspectDependencies: async () => healthyDependencies(), repairDependencies });

    await expect(service.repair()).resolves.toMatchObject({ state: 'ready', runtime: { runtime: 'bubblewrap', available: true } });
    expect(repairDependencies).toHaveBeenCalledWith({ runtime: settings.runtime, distribution: settings.distribution, profile: settings.profile });
    expect(inspectRuntime).toHaveBeenCalledTimes(2);
  });

  it('does not repair a sandbox that is disabled in settings', async () => {
    const disabledSettings = { ...settings, runtime: 'disabled' as const };
    const repairRuntime = vi.fn(async () => ({ runtime: 'wsl2' as const, available: true, distribution: settings.distribution }));
    const repairDependencies = vi.fn(async () => healthyDependencies());
    const inspectRuntime = vi.fn(async () => ({ runtime: 'unsupported' as const, available: false, distribution: settings.distribution }));
    const service = new VmHealthService({ getSettings: async () => disabledSettings, inspectRuntime, repairRuntime, inspectDependencies: async () => healthyDependencies(), repairDependencies });

    await expect(service.repair()).resolves.toMatchObject({ state: 'disabled' });
    expect(repairRuntime).not.toHaveBeenCalled();
    expect(repairDependencies).not.toHaveBeenCalled();
  });

  it('repairs through the dependency owner and refreshes health', async () => {
    const repair = vi.fn(async () => healthyDependencies());
    const service = new VmHealthService({ getSettings: async () => settings, inspectRuntime: async () => ({ runtime: 'wsl2', available: true, distribution: settings.distribution }), inspectDependencies: async () => healthyDependencies(), repairDependencies: repair });
    await service.repair();
    expect(repair).toHaveBeenCalledWith({ runtime: settings.runtime, distribution: settings.distribution, profile: settings.profile });
  });

  it('imports the shared guest image after host WSL repair makes the runtime available', async () => {
    const repairRuntime = vi.fn(async () => ({ runtime: 'wsl2' as const, available: true, distribution: '', isolation: 'vm' as const }));
    const inspectRuntime = vi.fn(async () => ({ runtime: 'wsl2' as const, available: true, distribution: settings.distribution, isolation: 'vm' as const }));
    const repairDependencies = vi.fn(async () => healthyDependencies());
    const service = new VmHealthService({ getSettings: async () => settings, inspectRuntime, repairRuntime, inspectDependencies: async () => healthyDependencies(), repairDependencies });

    await expect(service.repair()).resolves.toMatchObject({ state: 'ready', runtime: { distribution: settings.distribution } });
    expect(repairDependencies).toHaveBeenCalledWith({ runtime: settings.runtime, distribution: settings.distribution, profile: settings.profile });
    expect(inspectRuntime).toHaveBeenCalledWith(settings.distribution);
  });
});

function createService(runtime: { available: boolean; reason?: string }, dependency: Partial<GuestDependencyReport>): VmHealthService {
  return new VmHealthService({
    getSettings: async () => settings,
    inspectRuntime: async () => ({ runtime: 'wsl2', available: runtime.available, distribution: settings.distribution, isolation: 'vm', ...(runtime.reason === undefined ? {} : { reason: runtime.reason }) }),
    inspectDependencies: async () => ({ ...healthyDependencies(), ...dependency, statuses: dependency.statuses ?? [], missing: dependency.missing ?? [], manual: dependency.manual ?? [], failed: dependency.failed ?? [] }),
    repairDependencies: async () => healthyDependencies(),
  });
}

function healthyDependencies(): GuestDependencyReport {
  return { runtime: 'wsl2', distribution: settings.distribution, profile: settings.profile, available: true, statuses: [], installed: [], missing: [], manual: [], failed: [] };
}
