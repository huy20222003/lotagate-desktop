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

describe('DesktopAuthService.logout', () => {
  it('stops local agent processes before requesting server logout and always clears the session', async () => {
    const order: string[] = [];
    const transport = {
      request: vi.fn(async () => { order.push('logout'); }),
      clearSession: vi.fn(async () => { order.push('clear'); }),
    } as unknown as ApiTransport;
    const service = new DesktopAuthService(transport, async () => { order.push('stop-agents'); });

    await service.logout();

    expect(order).toEqual(['stop-agents', 'logout', 'clear']);
  });

  it('clears the session when server logout fails', async () => {
    const transport = {
      request: vi.fn().mockRejectedValue(new DesktopApiError(503, 'Unavailable')),
      clearSession: vi.fn().mockResolvedValue(undefined),
    } as unknown as ApiTransport;
    const service = new DesktopAuthService(transport, vi.fn().mockResolvedValue(undefined));

    await expect(service.logout()).rejects.toThrow('Unavailable');
    expect(transport.clearSession).toHaveBeenCalledOnce();
  });
});
