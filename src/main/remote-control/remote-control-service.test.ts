import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRemoteCipher, createRemoteKeyPair, type EncryptedRemoteEnvelope } from './remote-control-crypto.js';
import { REMOTE_MEDIA_READ_CHUNK_BYTES } from '../../contracts/remote-control/v1/remote-control.js';
import { RemoteControlService } from './remote-control-service.js';

const { sockets } = vi.hoisted(() => ({ sockets: [] as Array<{ readyState: number; sent: string[]; open: () => void; message: (data: string) => void; close: (code?: number) => void }> }));

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
    message(data: string): void { this.handlers.get('message')?.(data); }
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
    sockets[0]!.message(JSON.stringify({ version: 1, type: 'auth.accepted' }));
    expect(service.get()).toMatchObject({ status: 'connected' });

    await service.revoke();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ method: 'DELETE' });
  });

  it('keeps a full media chunk intact through the encrypted artifact.read response', async () => {
    const sessionId = '22222222-2222-4222-8222-222222222222';
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ sessionId, hostToken: 'host-secret', pairingToken: 'pairing-token', expiresAt: '2099-09-02T01:00:00.000Z', connectUrl: `https://remote.example/connect#session=${sessionId}&token=pairing-token` }), { status: 201, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    const bytes = Buffer.alloc(REMOTE_MEDIA_READ_CHUNK_BYTES, 0xab);
    const readMediaChunk = vi.fn().mockResolvedValue({ artifact: { id: 'artifact-1', taskId: 'task-1', name: 'gift_2.jpg', path: 'C:\\artifacts\\gift_2.jpg', kind: 'image', size: bytes.length, createdAt: '2026-09-02T00:00:00.000Z' }, mimeType: 'image/jpeg', bytes });
    const service = new RemoteControlService({ serverUrl: 'https://remote.example', enrollmentToken: 'desktop-enrollment-test-token', tasks: {} as never, workspaces: {} as never, workspaceFileSuggestions: {} as never, agents: {} as never, approvals: {} as never, artifacts: { readMediaChunk } as never, logger: { warn: vi.fn() } as never });

    await service.create();
    const socket = sockets[0]!;
    socket.open();
    const hostAuth = JSON.parse(socket.sent[0]!);
    const controllerKeyPair = createRemoteKeyPair();
    const controllerCipher = createRemoteCipher(controllerKeyPair, hostAuth.publicKey, sessionId);
    socket.message(JSON.stringify({ version: 1, type: 'auth.accepted', peerPublicKey: controllerKeyPair.publicKey }));
    const commandId = '33333333-3333-4333-8333-333333333333';
    socket.message(JSON.stringify(controllerCipher.encrypt('command', { action: 'artifact.read', taskId: 'task-1', artifactId: 'artifact-1', offset: 0, length: REMOTE_MEDIA_READ_CHUNK_BYTES }, commandId, 0)));

    await new Promise(resolve => setTimeout(resolve, 0));
    const responses = socket.sent.slice(1).map(raw => JSON.parse(raw) as EncryptedRemoteEnvelope).map(envelope => controllerCipher.decrypt(envelope));
    const response = responses.find(message => message.type === 'command.result');
    const result = (response?.payload as { result?: { bytes?: string } } | undefined)?.result;
    expect(readMediaChunk).toHaveBeenCalledWith('task-1', 'artifact-1', 0, REMOTE_MEDIA_READ_CHUNK_BYTES);
    expect(result?.bytes).toBe(bytes.toString('base64url'));

    await service.stop();
  });

  it('preserves numeric media sizes in deeply nested snapshots', async () => {
    const sessionId = '44444444-4444-4444-8444-444444444444';
    const taskId = 'task-1';
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ sessionId, hostToken: 'host-secret', pairingToken: 'pairing-token', expiresAt: '2099-09-02T01:00:00.000Z', connectUrl: `https://remote.example/connect#session=${sessionId}&token=pairing-token` }), { status: 201, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    const task = { id: taskId, workspaceId: 'workspace-1', title: 'Test chat', cwd: 'C:\\workspace', status: 'idle', pinned: false, archived: false, draft: '', draftAttachmentIds: [], createdAt: '2026-09-02T00:00:00.000Z', updatedAt: '2026-09-02T00:00:00.000Z' };
    const service = new RemoteControlService({ serverUrl: 'https://remote.example', enrollmentToken: 'desktop-enrollment-test-token', tasks: { list: vi.fn().mockResolvedValue([task]), require: vi.fn().mockResolvedValue(task), activitiesPage: vi.fn().mockResolvedValue({ activities: [{ id: 'activity-1', taskId, kind: 'user', text: 'Show image', createdAt: '2026-09-02T00:00:00.000Z', metadata: { artifactIds: ['artifact-1'] } }] }) } as never, workspaces: { list: vi.fn().mockResolvedValue([{ id: 'workspace-1', name: 'Workspace', rootPath: 'C:\\workspace' }]) } as never, workspaceFileSuggestions: {} as never, agents: { commandList: vi.fn().mockResolvedValue(undefined), commandExecuteResult: vi.fn().mockResolvedValue(undefined), modelList: vi.fn().mockResolvedValue(undefined) } as never, approvals: { listPending: vi.fn().mockReturnValue([]) } as never, artifacts: { list: vi.fn().mockResolvedValue([{ id: 'artifact-1', taskId, name: 'gift.jpg', path: 'C:\\artifacts\\gift.jpg', kind: 'image', size: 6422, createdAt: '2026-09-02T00:00:00.000Z' }]) } as never, logger: { warn: vi.fn() } as never });

    await service.create();
    const socket = sockets[0]!;
    socket.open();
    const hostAuth = JSON.parse(socket.sent[0]!);
    const controllerKeyPair = createRemoteKeyPair();
    const controllerCipher = createRemoteCipher(controllerKeyPair, hostAuth.publicKey, sessionId);
    socket.message(JSON.stringify({ version: 1, type: 'auth.accepted', peerPublicKey: controllerKeyPair.publicKey }));
    socket.message(JSON.stringify(controllerCipher.encrypt('command', { action: 'snapshot.request', taskId }, 'snapshot-request', 0)));

    await new Promise(resolve => setTimeout(resolve, 0));
    const responses = socket.sent.slice(1).map(raw => JSON.parse(raw) as EncryptedRemoteEnvelope).map(envelope => controllerCipher.decrypt(envelope));
    const response = responses.find(message => message.type === 'command.result');
    const snapshot = (response?.payload as { result?: { task?: { attachments?: Record<string, Array<{ size?: unknown }>> } } } | undefined)?.result;
    expect(snapshot?.task?.attachments?.['activity-1']?.[0]?.size).toBe(6422);

    await service.stop();
  });
});
