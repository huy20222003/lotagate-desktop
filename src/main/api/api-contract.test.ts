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
});
