import { randomUUID } from 'node:crypto';
import { API_PATHS, type AnalyticsDateRange } from './api-contract.js';
import type { ApiTransport } from './api-transport.js';
import { CACHE_TTL_MS } from '../cache/cache-policy.js';
import type { PersistentCache } from '../cache/persistent-cache.js';

export class DesktopUserContextService {
  private readonly inFlight = new Map<string, Promise<unknown>>();
  private readonly cacheNamespace = randomUUID();
  private sessionGeneration = 0;

  constructor(private readonly transport: ApiTransport, private readonly cache: PersistentCache) {}
  organizations(): Promise<unknown> { return this.cached('organizations', CACHE_TTL_MS.organizations, () => this.transport.request(API_PATHS.organizations, 'GET')); }
  organization(organizationCode: string): Promise<unknown> { return this.cached(`organization:${organizationCode}`, CACHE_TTL_MS.organization, () => this.transport.request(`/organizations/${encodeURIComponent(organizationCode)}`, 'GET')); }
  wallet(organizationCode: string): Promise<unknown> { return this.transport.request(API_PATHS.organizationWallet(organizationCode), 'GET'); }
  usage(organizationCode: string, workspaceCode?: string, dateRange: AnalyticsDateRange = previousYearDateRange()): Promise<unknown> { return this.transport.request(API_PATHS.organizationUsage(organizationCode, workspaceCode, dateRange), 'GET'); }
  dashboardStats(organizationCode: string, workspaceCode?: string, dateRange: AnalyticsDateRange = previousYearDateRange()): Promise<unknown> { return this.transport.request(API_PATHS.organizationDashboardStats(organizationCode, workspaceCode, dateRange), 'GET'); }
  paymentHistory(organizationCode: string, page = 1, limit = 10): Promise<unknown> { return this.transport.request(API_PATHS.paymentHistory(organizationCode, page, limit), 'GET'); }
  workspaces(organizationCode: string): Promise<unknown> { return this.cached(`workspaces:${organizationCode}`, CACHE_TTL_MS.workspaces, () => this.transport.request(`/organizations/${encodeURIComponent(organizationCode)}/workspaces`, 'GET')); }
  models(organizationCode: string, workspaceCode: string): Promise<unknown> { return this.cached(`models:${organizationCode}:${workspaceCode}`, CACHE_TTL_MS.models, () => this.transport.request(`/organizations/${encodeURIComponent(organizationCode)}/workspaces/${encodeURIComponent(workspaceCode)}/models`, 'GET')); }

  /** Invalidates requests started under the previous authenticated session. */
  resetSession(): void {
    this.sessionGeneration += 1;
    this.inFlight.clear();
  }

  private async cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
    const generation = this.sessionGeneration;
    const scopedKey = `${this.cacheNamespace}:${generation}:${key}`;
    const cached = await this.cache.get<T>(scopedKey);
    if (generation !== this.sessionGeneration) throw new Error('The authenticated session changed while loading user context.');
    if (cached !== undefined) return cached;
    const pending = this.inFlight.get(scopedKey);
    if (pending !== undefined) return pending as Promise<T>;
    const operation = (async () => {
      const value = await load();
      if (generation !== this.sessionGeneration) throw new Error('The authenticated session changed while loading user context.');
      await this.cache.set(scopedKey, value, ttlMs);
      if (generation !== this.sessionGeneration) throw new Error('The authenticated session changed while loading user context.');
      return value;
    })();
    this.inFlight.set(scopedKey, operation);
    try {
      return await operation;
    } finally {
      if (this.inFlight.get(scopedKey) === operation) this.inFlight.delete(scopedKey);
    }
  }
}

export function previousYearDateRange(now = new Date()): AnalyticsDateRange {
  const endDate = new Date(now);
  const startDate = new Date(now);
  startDate.setUTCFullYear(startDate.getUTCFullYear() - 1);
  return { startDate: formatApiDate(startDate), endDate: formatApiDate(endDate) };
}

function formatApiDate(value: Date): string {
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${pad(value.getUTCDate())}/${pad(value.getUTCMonth() + 1)}/${value.getUTCFullYear()}`;
}
