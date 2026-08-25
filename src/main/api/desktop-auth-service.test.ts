import { describe, expect, it, vi } from 'vitest';
import { API_PATHS } from './api-contract.js';
import { DesktopAuthService } from './desktop-auth-service.js';
import { DesktopApiError, type ApiTransport } from './api-transport.js';

describe('DesktopAuthService.restoreSession', () => {
  it('refreshes the persistent cookie session before loading the user profile', async () => {
    const transport = {
      restoreSession: vi.fn().mockResolvedValue(true),
      request: vi.fn().mockResolvedValue({ id: 'user-1', email: 'user@example.com' }),
    } as unknown as ApiTransport;
    const service = new DesktopAuthService(transport);

    await expect(service.restoreSession()).resolves.toMatchObject({ id: 'user-1' });
    expect(transport.restoreSession).toHaveBeenCalledOnce();
    expect(transport.request).toHaveBeenCalledWith(API_PATHS.me, 'GET', undefined, { retryOnUnauthorized: false });
  });

  it('does not call the profile endpoint when no persistent refresh cookie exists', async () => {
    const transport = {
      restoreSession: vi.fn().mockResolvedValue(false),
      request: vi.fn(),
    } as unknown as ApiTransport;
    const service = new DesktopAuthService(transport);

    await expect(service.restoreSession()).resolves.toBeNull();
    expect(transport.request).not.toHaveBeenCalled();
  });

  it('clears the session when the restored cookie cannot load a profile', async () => {
    const transport = {
      restoreSession: vi.fn().mockResolvedValue(true),
      request: vi.fn().mockRejectedValue(new DesktopApiError(401, 'Unauthorized')),
      clearSession: vi.fn().mockResolvedValue(undefined),
    } as unknown as ApiTransport;
    const service = new DesktopAuthService(transport);

    await expect(service.restoreSession()).resolves.toBeNull();
    expect(transport.clearSession).toHaveBeenCalledOnce();
  });
});
