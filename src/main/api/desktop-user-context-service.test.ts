import { describe, expect, it, vi } from 'vitest';
import { DesktopUserContextService } from './desktop-user-context-service.js';
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
