import type { VmEnvironmentIdentity, VmRuntimeAdapter, VmRuntimeExecuteInput, VmRuntimeExecutionResult, VmRuntimeStartInput } from './vm-types.js';
import { SandboxUnavailableError } from './vm-runtime-adapter.js';
import { isAbsolute, relative, sep } from 'node:path';

interface EnvironmentEntry {
  readonly identity: VmEnvironmentIdentity;
  readonly runtime: VmRuntimeStartInput;
  readonly environment: Awaited<ReturnType<VmRuntimeAdapter['start']>>;
  active: number;
  lastUsedAt: number;
  idleTimer: ReturnType<typeof setTimeout> | undefined;
}

/** Owns warm guest environments and their idle/eviction lifecycle. */
export class VmEnvironmentManager {
  private readonly environments = new Map<string, EnvironmentEntry>();
  private readonly capacityWaiters: Array<() => void> = [];
  private readonly pendingStarts = new Set<ReturnType<VmRuntimeAdapter['start']>>();
  private starting = 0;

  constructor(private readonly runtime: VmRuntimeAdapter) {}

  async execute(identity: VmEnvironmentIdentity, startInput: VmRuntimeStartInput, input: VmRuntimeExecuteInput, maxConcurrentEnvironments: number): Promise<VmRuntimeExecutionResult> {
    const entry = await this.acquire(identity, startInput, maxConcurrentEnvironments, input.signal);
    try {
      return await entry.environment.execute(input);
    } catch (error) {
      if (isGuestProcessFailure(error)) await this.discard(entry);
      throw error;
    } finally {
      this.release(entry);
    }
  }

  async closeAll(): Promise<void> {
    while (this.pendingStarts.size > 0) await Promise.allSettled([...this.pendingStarts]);
    const entries = [...this.environments.values()];
    this.environments.clear();
    await Promise.all(entries.map(entry => this.closeEntry(entry)));
    this.releaseCapacityWaiters();
  }

  async closeWorkspace(root: string): Promise<void> {
    while (this.pendingStarts.size > 0) await Promise.allSettled([...this.pendingStarts]);
    const entries = [...this.environments.values()].filter(entry => isPathWithin(root, entry.identity.root));
    for (const entry of entries) {
      if (this.environments.get(entry.identity.key) !== entry) continue;
      this.environments.delete(entry.identity.key);
      await this.closeEntry(entry);
    }
    this.releaseCapacityWaiters();
  }

  size(): number { return this.environments.size; }

  private async acquire(identity: VmEnvironmentIdentity, startInput: VmRuntimeStartInput, limit: number, signal?: AbortSignal): Promise<EnvironmentEntry> {
    if (signal?.aborted === true) throw new Error('VM sandbox execution was cancelled.');
    const existing = this.environments.get(identity.key);
    if (existing !== undefined) {
      existing.active += 1;
      existing.lastUsedAt = Date.now();
      if (existing.idleTimer !== undefined) clearTimeout(existing.idleTimer);
      existing.idleTimer = undefined;
      return existing;
    }
    const normalizedLimit = Math.max(1, Math.trunc(limit));
    let capacityReserved = false;
    while (this.environments.size + this.starting >= normalizedLimit) {
      const idle = [...this.environments.values()].filter(item => item.active === 0).sort((left, right) => left.lastUsedAt - right.lastUsedAt)[0];
      if (idle !== undefined) {
        this.environments.delete(idle.identity.key);
        this.starting += 1;
        capacityReserved = true;
        await this.closeEntry(idle);
        break;
      }
      await this.waitForCapacity(signal);
    }
    let environment: Awaited<ReturnType<VmRuntimeAdapter['start']>>;
    if (!capacityReserved) this.starting += 1;
    const startOperation = this.runtime.start({ ...startInput, ...(signal === undefined ? {} : { signal }) });
    this.pendingStarts.add(startOperation);
    try {
      environment = await startOperation;
    } catch (error) {
      if (isCancellationRequested(signal)) throw error instanceof Error ? error : new Error('VM sandbox execution was cancelled.');
      throw error instanceof SandboxUnavailableError ? error : new SandboxUnavailableError(error instanceof Error ? error.message : 'The VM environment could not be started.');
    } finally {
      this.pendingStarts.delete(startOperation);
      this.starting = Math.max(0, this.starting - 1);
      this.releaseCapacityWaiters();
    }
    const entry: EnvironmentEntry = { identity, runtime: startInput, environment, active: 1, lastUsedAt: Date.now(), idleTimer: undefined };
    this.environments.set(identity.key, entry);
    return entry;
  }

  private release(entry: EnvironmentEntry): void {
    if (!this.environments.has(entry.identity.key)) return;
    entry.active = Math.max(0, entry.active - 1);
    entry.lastUsedAt = Date.now();
    if (entry.active === 0) {
      const timeoutMs = Math.max(1, Math.trunc(entry.runtime.idleTimeoutMinutes * 60 * 1_000));
      entry.idleTimer = setTimeout(() => { void this.expire(entry); }, timeoutMs);
      entry.idleTimer.unref?.();
      this.releaseCapacityWaiters();
    }
  }

  private async expire(entry: EnvironmentEntry): Promise<void> {
    if (entry.active !== 0 || this.environments.get(entry.identity.key) !== entry) return;
    this.environments.delete(entry.identity.key);
    await this.closeEntry(entry);
    this.releaseCapacityWaiters();
  }

  private async discard(entry: EnvironmentEntry): Promise<void> {
    if (this.environments.get(entry.identity.key) !== entry) return;
    this.environments.delete(entry.identity.key);
    await this.closeEntry(entry);
    this.releaseCapacityWaiters();
  }

  private async closeEntry(entry: EnvironmentEntry): Promise<void> {
    if (entry.idleTimer !== undefined) clearTimeout(entry.idleTimer);
    await entry.environment.close().catch(() => undefined);
  }

  private waitForCapacity(signal?: AbortSignal): Promise<void> {
    if (signal?.aborted === true) return Promise.reject(new Error('VM sandbox execution was cancelled.'));
    return new Promise((resolve, reject) => {
      const waiter = (): void => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      };
      const onAbort = (): void => {
        const index = this.capacityWaiters.indexOf(waiter);
        if (index >= 0) this.capacityWaiters.splice(index, 1);
        reject(new Error('VM sandbox execution was cancelled.'));
      };
      this.capacityWaiters.push(waiter);
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }

  private releaseCapacityWaiters(): void {
    while (this.capacityWaiters.length > 0) this.capacityWaiters.shift()?.();
  }
}

function isGuestProcessFailure(error: unknown): boolean {
  return error instanceof Error && (error.name === 'VmGuestProcessError' || /guest channel is closed|guest channel exited|VM guest execution timed out|VM sandbox execution was cancelled|guest request could not be written/iu.test(error.message));
}

function isCancellationRequested(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

function isPathWithin(root: string, candidate: string): boolean {
  const child = relative(root, candidate);
  return child === '' || (!isAbsolute(child) && child !== '..' && !child.startsWith(`..${sep}`));
}
