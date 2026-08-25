import { API_PATHS } from './api-contract.js';
import type { ApiTransport } from './api-transport.js';

export class DesktopUserContextService {
  constructor(private readonly transport: ApiTransport) {}
  organizations(): Promise<unknown> { return this.transport.request(API_PATHS.organizations, 'GET'); }
  organization(organizationCode: string): Promise<unknown> { return this.transport.request(`/organizations/${encodeURIComponent(organizationCode)}`, 'GET'); }
  wallet(organizationCode: string): Promise<unknown> { return this.transport.request(API_PATHS.organizationWallet(organizationCode), 'GET'); }
  usage(organizationCode: string, workspaceCode?: string): Promise<unknown> { return this.transport.request(API_PATHS.organizationUsage(organizationCode, workspaceCode), 'GET'); }
  dashboardStats(organizationCode: string, workspaceCode?: string): Promise<unknown> { return this.transport.request(API_PATHS.organizationDashboardStats(organizationCode, workspaceCode), 'GET'); }
  workspaces(organizationCode: string): Promise<unknown> { return this.transport.request(`/organizations/${encodeURIComponent(organizationCode)}/workspaces`, 'GET'); }
  models(organizationCode: string, workspaceCode: string): Promise<unknown> { return this.transport.request(`/organizations/${encodeURIComponent(organizationCode)}/workspaces/${encodeURIComponent(workspaceCode)}/models`, 'GET'); }
}
