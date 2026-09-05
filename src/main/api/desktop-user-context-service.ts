import { API_PATHS, type AnalyticsDateRange } from './api-contract.js';
import type { ApiTransport } from './api-transport.js';
import { CACHE_TTL_MS } from '../cache/cache-policy.js';
import type { PersistentCache } from '../cache/persistent-cache.js';

export class DesktopUserContextService {
  private readonly inFlight = new Map<string, Promise<unknown>>();

  constructor(private readonly transport: ApiTransport, private readonly cache: PersistentCache) {}
  organizations(): Promise<unknown> { return this.cached('organizations', CACHE_TTL_MS.organizations, () => this.transport.request(API_PATHS.organizations, 'GET')); }
  organization(organizationCode: string): Promise<unknown> { return this.cached(`organization:${organizationCode}`, CACHE_TTL_MS.organization, () => this.transport.request(`/organizations/${encodeURIComponent(organizationCode)}`, 'GET')); }
  wallet(organizationCode: string): Promise<unknown> { return this.transport.request(API_PATHS.organizationWallet(organizationCode), 'GET'); }
  usage(organizationCode: string, workspaceCode?: string, dateRange: AnalyticsDateRange = previousYearDateRange()): Promise<unknown> { return this.transport.request(API_PATHS.organizationUsage(organizationCode, workspaceCode, dateRange), 'GET'); }
  dashboardStats(organizationCode: string, workspaceCode?: string, dateRange: AnalyticsDateRange = previousYearDateRange()): Promise<unknown> { return this.transport.request(API_PATHS.organizationDashboardStats(organizationCode, workspaceCode, dateRange), 'GET'); }
  paymentHistory(organizationCode: string, page = 1, limit = 10): Promise<unknown> { return this.transport.request(API_PATHS.paymentHistory(organizationCode, page, limit), 'GET'); }
  workspaces(organizationCode: string): Promise<unknown> { return this.cached(`workspaces:${organizationCode}`, CACHE_TTL_MS.workspaces, () => this.transport.request(`/organizations/${encodeURIComponent(organizationCode)}/workspaces`, 'GET')); }
  models(organizationCode: string, workspaceCode: string): Promise<unknown> { return this.cached(`models:${organizationCode}:${workspaceCode}`, CACHE_TTL_MS.models, () => this.transport.request(`/organizations/${encodeURIComponent(organizationCode)}/workspaces/${encodeURIComponent(workspaceCode)}/models`, 'GET')); }

  private async cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
    const cached = await this.cache.get<T>(key);
    if (cached !== undefined) return cached;
    const pending = this.inFlight.get(key);
    if (pending !== undefined) return pending as Promise<T>;
    const operation = (async () => {
      const value = await load();
      await this.cache.set(key, value, ttlMs);
      return value;
    })();
    this.inFlight.set(key, operation);
    try {
      return await operation;
    } finally {
      if (this.inFlight.get(key) === operation) this.inFlight.delete(key);
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
