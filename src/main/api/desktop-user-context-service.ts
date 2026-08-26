import { API_PATHS } from './api-contract.js';
import type { ApiTransport } from './api-transport.js';
import { CACHE_TTL_MS } from '../cache/cache-policy.js';
import type { PersistentCache } from '../cache/persistent-cache.js';

export class DesktopUserContextService {
  private readonly inFlight = new Map<string, Promise<unknown>>();

  constructor(private readonly transport: ApiTransport, private readonly cache: PersistentCache) {}
  organizations(): Promise<unknown> { return this.cached('organizations', CACHE_TTL_MS.organizations, () => this.transport.request(API_PATHS.organizations, 'GET')); }
  organization(organizationCode: string): Promise<unknown> { return this.cached(`organization:${organizationCode}`, CACHE_TTL_MS.organization, () => this.transport.request(`/organizations/${encodeURIComponent(organizationCode)}`, 'GET')); }
  wallet(organizationCode: string): Promise<unknown> { return this.transport.request(API_PATHS.organizationWallet(organizationCode), 'GET'); }
  usage(organizationCode: string, workspaceCode?: string): Promise<unknown> { return this.transport.request(API_PATHS.organizationUsage(organizationCode, workspaceCode), 'GET'); }
  dashboardStats(organizationCode: string, workspaceCode?: string): Promise<unknown> { return this.transport.request(API_PATHS.organizationDashboardStats(organizationCode, workspaceCode), 'GET'); }
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
