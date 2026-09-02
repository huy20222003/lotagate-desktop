import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RemoteControlService } from './remote-control-service.js';

const { sockets } = vi.hoisted(() => ({ sockets: [] as Array<{ readyState: number; sent: string[]; open: () => void; close: (code?: number) => void }> }));

vi.mock('ws', () => {
  class FakeWebSocket {
    static readonly OPEN = 1;
    readyState = 0;
    private readonly handlers = new Map<string, (...args: unknown[]) => void>();

    constructor(_url: URL) {
      sockets.push(this);
    }

    on(event: string, handler: (...args: unknown[]) => void): this {
      this.handlers.set(event, handler);
      return this;
    }

    sent: string[] = [];
    send(data: string): void { this.sent.push(data); }
    open(): void { this.readyState = FakeWebSocket.OPEN; this.handlers.get('open')?.(); }
    close(code = 1000): void { this.readyState = 3; this.handlers.get('close')?.(code); }
  }

  return { WebSocket: FakeWebSocket };
});

describe('RemoteControlService', () => {
  beforeEach(() => { sockets.length = 0; vi.restoreAllMocks(); });

  it('creates a relay session without exposing the host credential to the renderer', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ sessionId: '11111111-1111-4111-8111-111111111111', hostToken: 'host-secret', pairingToken: 'pairing-token', expiresAt: '2026-09-02T01:00:00.000Z', connectUrl: 'https://remote.example/connect#session=11111111-1111-4111-8111-111111111111&token=pairing-token' }), { status: 201, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    const service = new RemoteControlService({ serverUrl: 'https://remote.example', enrollmentToken: 'desktop-enrollment-test-token', tasks: {} as never, workspaces: {} as never, workspaceFileSuggestions: {} as never, agents: {} as never, approvals: {} as never, artifacts: {} as never, logger: { warn: vi.fn() } as never });

    const session = await service.create();
    expect(session).toMatchObject({ sessionId: '11111111-1111-4111-8111-111111111111', status: 'connecting' });
    expect(service.get()).not.toHaveProperty('hostToken');
    expect(sockets).toHaveLength(1);
    sockets[0]!.open();
    expect(service.get()).toMatchObject({ status: 'connecting' });
    expect(JSON.parse(sockets[0]!.sent[0]!).type).toBe('auth');

    await service.revoke();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ method: 'DELETE' });
  });
});
