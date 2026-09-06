import { describe, expect, it, vi } from 'vitest';
import { DesktopUserContextService, previousYearDateRange } from './desktop-user-context-service.js';
import type { ApiTransport } from './api-transport.js';
import type { PersistentCache } from '../cache/persistent-cache.js';

describe('DesktopUserContextService.paymentHistory', () => {
  it('requests organization-scoped payments with the server pagination contract', async () => {
    const transport = { request: vi.fn().mockResolvedValue({ data: [], total: 0 }) } as unknown as ApiTransport;
    const service = new DesktopUserContextService(transport, {} as PersistentCache);

    await service.paymentHistory('acme', 1, 10);

    expect(transport.request).toHaveBeenCalledWith('/organizations/acme/payments?page=1&limit=10', 'GET');
  });
});

describe('DesktopUserContextService.usage', () => {
  it('requests the organization usage window from one year ago through today', async () => {
    const transport = { request: vi.fn().mockResolvedValue([]) } as unknown as ApiTransport;
    const service = new DesktopUserContextService(transport, {} as PersistentCache);
    const now = new Date('2026-09-05T23:30:00.000Z');
    vi.useFakeTimers();
    vi.setSystemTime(now);

    try {
      await service.usage('acme');
    } finally {
      vi.useRealTimers();
    }

    expect(transport.request).toHaveBeenCalledWith('/organizations/acme/usage?startDate=05%2F09%2F2025&endDate=05%2F09%2F2026', 'GET');
  });

  it('formats the range using UTC calendar dates', () => {
    expect(previousYearDateRange(new Date('2026-09-05T23:30:00.000Z'))).toEqual({ startDate: '05/09/2025', endDate: '05/09/2026' });
  });
});

describe('DesktopUserContextService.dashboardStats', () => {
  it('requests dashboard statistics for the same one-year window', async () => {
    const transport = { request: vi.fn().mockResolvedValue({}) } as unknown as ApiTransport;
    const service = new DesktopUserContextService(transport, {} as PersistentCache);
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-05T23:30:00.000Z'));

    try {
      await service.dashboardStats('acme');
    } finally {
      vi.useRealTimers();
    }

    expect(transport.request).toHaveBeenCalledWith('/organizations/acme/dashboard-stats?startDate=05%2F09%2F2025&endDate=05%2F09%2F2026', 'GET');
  });
});

describe('DesktopUserContextService session isolation', () => {
  it('does not let a pre-logout response populate the next session cache', async () => {
    let resolveFirst: ((value: unknown) => void) | undefined;
    const transport = {
      request: vi.fn()
        .mockImplementationOnce(() => new Promise(resolve => { resolveFirst = resolve; }))
        .mockResolvedValueOnce({ id: 'organization-new' }),
    } as unknown as ApiTransport;
    const cache = { get: vi.fn().mockResolvedValue(undefined), set: vi.fn().mockResolvedValue(undefined) } as unknown as PersistentCache;
    const service = new DesktopUserContextService(transport, cache);
    const first = service.organizations();
    await vi.waitFor(() => expect(transport.request).toHaveBeenCalledOnce());

    service.resetSession();
    resolveFirst?.({ id: 'organization-old' });

    await expect(first).rejects.toThrow('authenticated session changed');
    await expect(service.organizations()).resolves.toEqual({ id: 'organization-new' });
    expect(transport.request).toHaveBeenCalledTimes(2);
    expect(cache.set).toHaveBeenCalledOnce();
  });
});
