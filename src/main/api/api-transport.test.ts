import { describe, expect, it, vi } from 'vitest';
import { API_PATHS } from './api-contract.js';
import { ApiTransport } from './api-transport.js';

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));
vi.mock('electron', () => ({ session: { fromPartition: vi.fn(() => ({ fetch: fetchMock, cookies: { get: vi.fn(async () => []) }, clearStorageData: vi.fn(async () => undefined) })) } }));

describe('ApiTransport request limits', () => {
  it('aborts a request that exceeds the configured timeout', async () => {
    fetchMock.mockImplementation((_url: string, options: { signal: AbortSignal }) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    }));
    const transport = new ApiTransport({ baseUrl: 'http://api.test', trustedOrigin: 'http://desktop.test', partition: 'test', requestTimeoutMs: 5 });

    await expect(transport.request(API_PATHS.cryptoSession, 'POST', { key: 'value' })).rejects.toMatchObject({ status: 0 });
  });

  it('rejects an API response larger than the configured limit', async () => {
    fetchMock.mockResolvedValue(new Response('123456789', { status: 200, headers: { 'content-length': '9' } }));
    const transport = new ApiTransport({ baseUrl: 'http://api.test', trustedOrigin: 'http://desktop.test', partition: 'test', maxResponseBytes: 8 });

    await expect(transport.request(API_PATHS.cryptoSession, 'POST', { key: 'value' })).rejects.toThrow('size limit');
  });
});
