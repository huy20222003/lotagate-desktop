import { describe, expect, it } from 'vitest';
import { API_PATHS, isDesktopApiPathAllowed } from './api-contract.js';

describe('desktop user API allowlist', () => {
  it('allows only approved user routes', () => {
    expect(isDesktopApiPathAllowed('/auth/login')).toBe(true);
    expect(isDesktopApiPathAllowed('/organizations/acme/workspaces/main/models')).toBe(true);
    expect(isDesktopApiPathAllowed('/organizations/acme/usage')).toBe(true);
    expect(isDesktopApiPathAllowed('/organizations/acme/workspaces/main/usage')).toBe(true);
    expect(isDesktopApiPathAllowed('/organizations/acme/dashboard-stats')).toBe(true);
    expect(isDesktopApiPathAllowed('/organizations/acme/workspaces/main/dashboard-stats')).toBe(true);
    expect(isDesktopApiPathAllowed('/admin/users')).toBe(false);
    expect(isDesktopApiPathAllowed('/users/123/status')).toBe(false);
    expect(isDesktopApiPathAllowed('/organizations/acme/workspaces')).toBe(true);
    expect(isDesktopApiPathAllowed(API_PATHS.paymentHistory('acme'))).toBe(true);
    expect(isDesktopApiPathAllowed('/users/payment-history')).toBe(false);
    expect(isDesktopApiPathAllowed('/organizations/acme/payments?page=1&limit=101')).toBe(false);
    expect(isDesktopApiPathAllowed('/organizations/acme/payments?page=1&limit=10&page=2')).toBe(false);
  });

  it('builds the organization payment history route with the server pagination contract', () => {
    expect(API_PATHS.paymentHistory('acme', 1, 10)).toBe('/organizations/acme/payments?page=1&limit=10');
    expect(API_PATHS.paymentHistory('org/code', 2, 20)).toBe('/organizations/org%2Fcode/payments?page=2&limit=20');
  });

  it('builds usage routes with the analytics date range contract', () => {
    expect(API_PATHS.organizationUsage('acme', undefined, { startDate: '05/09/2025', endDate: '05/09/2026' })).toBe('/organizations/acme/usage?startDate=05%2F09%2F2025&endDate=05%2F09%2F2026');
    expect(API_PATHS.organizationUsage('acme', 'main', { startDate: '05/09/2025', endDate: '05/09/2026' })).toBe('/organizations/acme/workspaces/main/usage?startDate=05%2F09%2F2025&endDate=05%2F09%2F2026');
  });

  it('builds dashboard statistics routes with the analytics date range contract', () => {
    expect(API_PATHS.organizationDashboardStats('acme', undefined, { startDate: '05/09/2025', endDate: '05/09/2026' })).toBe('/organizations/acme/dashboard-stats?startDate=05%2F09%2F2025&endDate=05%2F09%2F2026');
    expect(API_PATHS.organizationDashboardStats('acme', 'main', { startDate: '05/09/2025', endDate: '05/09/2026' })).toBe('/organizations/acme/workspaces/main/dashboard-stats?startDate=05%2F09%2F2025&endDate=05%2F09%2F2026');
  });

  it('allows only the public latest desktop release route', () => {
    expect(isDesktopApiPathAllowed(API_PATHS.desktopDownloadsLatest)).toBe(true);
    expect(isDesktopApiPathAllowed('/downloads/latest?unexpected=true')).toBe(false);
    expect(isDesktopApiPathAllowed('/admin/desktop-releases')).toBe(false);
  });
});
