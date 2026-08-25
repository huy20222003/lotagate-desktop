import { describe, expect, it } from 'vitest';
import { isDesktopApiPathAllowed } from './api-contract.js';

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
  });
});
