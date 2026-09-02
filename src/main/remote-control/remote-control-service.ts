import { randomUUID } from 'node:crypto';
import { WebSocket } from 'ws';
import { createRemoteCipher, createRemoteKeyPair, type EncryptedRemoteEnvelope, type RemoteCipher, type RemoteKeyPair } from './remote-control-crypto.js';
import { REMOTE_ATTACHMENT_CHUNK_BYTES, REMOTE_ATTACHMENT_MAX_BYTES, remoteCommandSchema, remoteControlSessionSchema, remoteEnvelopeSchema, remoteTaskSummary, remoteWorkspaceSummary, type RemoteCommand, type RemoteControlSession, type RemoteControlSnapshot, type RemoteControlStateEvent, type RemoteTrustRequest } from '../../contracts/remote-control/v1/remote-control.js';
import type { DesktopEvent } from '../../contracts/agent-protocol/v1/desktop.js';
import type { DesktopApprovalRequest, DesktopApprovalResolution } from '../../contracts/ipc/v1/approval.js';
import type { AutomationStateEvent } from '../../contracts/ipc/v1/automation.js';
import type { TaskStore } from '../tasks/task-store.js';
import type { WorkspaceRegistry } from '../workspaces/workspace-registry.js';
import type { AgentManager } from '../agents/agent-manager.js';
import type { ApprovalCoordinator } from '../approvals/approval-coordinator.js';
import type { DesktopLogger } from '../observability/desktop-logger.js';
import type { ArtifactService } from '../artifacts/artifact-service.js';
import type { WorkspaceFileSuggestions } from '../workspaces/workspace-file-suggestions.js';

interface RemoteServerSessionResponse { sessionId: string; hostToken: string; pairingToken: string; expiresAt: string; connectUrl: string }
interface RemoteRuntimeSession { publicState: RemoteControlSession; hostToken: string; socket: WebSocket | undefined; keyPair: RemoteKeyPair; cipher: RemoteCipher | undefined; sendChain: Promise<void>; nextSequence: number; lastReceivedSequence: number; reconnectAttempt: number; stopping: boolean; reconnectTimer: ReturnType<typeof setTimeout> | undefined; expiryTimer: ReturnType<typeof setTimeout> | undefined; uploadCleanupTimer: ReturnType<typeof setTimeout> | undefined; uploadStartReservations: number; uploads: Map<string, RemoteUpload>; requestLedger: Map<string, Promise<RemoteResponse>> }
interface RemoteResponse { type: 'command.result' | 'command.error'; payload: Record<string, unknown> }
interface QueuedRemotePrompt { taskId: string; prompt: string; model?: string; attachmentIds: string[] }
interface RemoteUpload { uploadId: string; taskId: string; name: string; mimeType: string; sizeBytes: number; chunkCount: number; chunks: Map<number, Buffer>; receivedBytes: number; expiresAt: number; completion?: Promise<unknown> }

const MAX_RECONNECT_DELAY_MS = 15_000;
const MAX_TASKS_PER_WORKSPACE = 100;
const MAX_ACTIVITY_ITEMS = 100;
const MAX_PENDING_TRUST_REQUESTS = 100;
const MAX_QUEUED_PROMPTS_PER_TASK = 20;
const REMOTE_REQUEST_TIMEOUT_MS = 10_000;
const REMOTE_UPLOAD_TTL_MS = 5 * 60_000;
const REMOTE_UPLOAD_CLEANUP_INTERVAL_MS = 60_000;

export class RemoteControlService {
  private runtime: RemoteRuntimeSession | undefined;
  private readonly listeners = new Set<(event: RemoteControlStateEvent) => void>();
  private readonly pendingTrustRequests = new Map<string, RemoteTrustRequest>();
  private readonly queuedPrompts = new Map<string, QueuedRemotePrompt[]>();
  private readonly drainingTasks = new Set<string>();

  constructor(private readonly options: { serverUrl: string; enrollmentToken?: string; tasks: TaskStore; workspaces: WorkspaceRegistry; workspaceFileSuggestions: WorkspaceFileSuggestions; agents: AgentManager; approvals: ApprovalCoordinator; artifacts: ArtifactService; logger: DesktopLogger }) {}

  get(): RemoteControlSession | null { return this.runtime?.publicState ?? null; }
  onState(listener: (event: RemoteControlStateEvent) => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }

  async create(): Promise<RemoteControlSession> {
    if (this.runtime !== undefined && !['expired', 'revoked', 'error'].includes(this.runtime.publicState.status)) return this.runtime.publicState;
    const serverUrl = normalizeServerUrl(this.options.serverUrl);
    if (serverUrl === undefined) throw new Error('Configure LOTAGATE_REMOTE_SERVER_URL before starting Remote Control.');
    this.clearRuntime();
    this.emitState({ status: 'creating' });
    const enrollmentToken = this.options.enrollmentToken?.trim();
    if (!enrollmentToken) throw new Error('Configure LOTAGATE_REMOTE_SERVER_ENROLLMENT_TOKEN before starting Remote Control.');
    const response = await fetchWithTimeout(`${serverUrl}/v1/sessions`, { method: 'POST', headers: { Accept: 'application/json', 'X-LotaGate-Desktop-Token': enrollmentToken } }, REMOTE_REQUEST_TIMEOUT_MS);
    if (!response.ok) throw new Error(`Remote server could not create a session (HTTP ${response.status}).`);
    const value = parseServerSession(await response.json());
    const publicState = remoteControlSessionSchema.parse({ sessionId: value.sessionId, connectUrl: value.connectUrl, expiresAt: value.expiresAt, status: 'connecting' });
    const runtime: RemoteRuntimeSession = { publicState, hostToken: value.hostToken, socket: undefined, keyPair: createRemoteKeyPair(), cipher: undefined, sendChain: Promise.resolve(), nextSequence: 0, lastReceivedSequence: -1, reconnectAttempt: 0, stopping: false, reconnectTimer: undefined, expiryTimer: undefined, uploadCleanupTimer: undefined, uploadStartReservations: 0, uploads: new Map(), requestLedger: new Map() };
    this.runtime = runtime;
    runtime.expiryTimer = setTimeout(() => this.expire(), Math.max(0, Date.parse(value.expiresAt) - Date.now()));
    this.emit();
    this.connect(runtime, value.sessionId);
    return publicState;
  }

  async revoke(): Promise<void> {
    const runtime = this.runtime;
    if (runtime === undefined) return;
    runtime.stopping = true;
    this.clearRuntimeTimers(runtime);
    runtime.socket?.close(1000, 'Remote session revoked.');
    const serverUrl = normalizeServerUrl(this.options.serverUrl);
    if (serverUrl !== undefined) await fetchWithTimeout(`${serverUrl}/v1/sessions/${encodeURIComponent(runtime.publicState.sessionId)}`, { method: 'DELETE', headers: { Authorization: `Bearer ${runtime.hostToken}` } }, REMOTE_REQUEST_TIMEOUT_MS).catch(() => undefined);
    runtime.publicState = remoteControlSessionSchema.parse({ ...runtime.publicState, status: 'revoked' });
    this.emit();
  }

  async stop(): Promise<void> { await this.revoke(); this.clearRuntime(); }

  publishAgentEvent(cwd: string, event: DesktopEvent): void {
    this.trackTrustRequest(cwd, event);
    if (!this.isConnected()) return;
    this.sendCurrent('event', { source: 'agent', cwd: workspaceKey(cwd), event: sanitizeValue(event) });
  }

  observeAgentEvent(event: DesktopEvent): void {
    const taskId = readString(event.data['taskId']);
    if (event.event === 'turn.completed' || event.event === 'turn.failed' || event.event === 'turn.cancelled') {
      if (taskId !== undefined) void this.drainQueuedPrompts(taskId);
      else { void this.options.tasks.findBySession(readString(event.data['sessionId']) ?? '').then(task => { if (task) void this.drainQueuedPrompts(task.id); }).catch(() => undefined); }
    }
    if (event.event === 'trust.resolved' || event.event === 'trust.responded') {
      const trustRequestId = readString(event.data['trustRequestId']);
      if (trustRequestId !== undefined) this.pendingTrustRequests.delete(trustRequestId);
    }
  }

  publishApprovalRequest(request: DesktopApprovalRequest): void { if (this.isConnected()) this.sendCurrent('approval.requested', sanitizeValue(request)); }
  publishApprovalResolution(resolution: DesktopApprovalResolution): void { if (this.isConnected()) this.sendCurrent('approval.resolved', sanitizeValue(resolution)); }
  publishAutomationState(event: AutomationStateEvent): void { if (this.isConnected()) this.sendCurrent('automation.state', sanitizeValue(event)); }

  private connect(runtime: RemoteRuntimeSession, sessionId: string): void {
    const serverUrl = normalizeServerUrl(this.options.serverUrl);
    if (serverUrl === undefined || runtime.stopping || this.runtime !== runtime) return;
    const url = new URL(`${serverUrl}/v1/ws`);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.searchParams.set('session', sessionId);
    url.searchParams.set('role', 'host');
    const socket = new WebSocket(url);
    runtime.socket = socket;
    socket.on('open', () => {
      if (this.runtime !== runtime) return;
      runtime.reconnectAttempt = 0;
      runtime.publicState = remoteControlSessionSchema.parse({ ...runtime.publicState, status: 'connecting', lastError: undefined });
      this.emit();
      socket.send(JSON.stringify({ version: 1, type: 'auth', sessionId, role: 'host', credential: runtime.hostToken, publicKey: runtime.keyPair.publicKey }));
    });
    socket.on('message', data => { void this.receive(runtime, socket, data.toString('utf8')); });
    socket.on('error', error => this.options.logger.warn('remote-control.socket.error', { message: error instanceof Error ? error.message : 'Remote socket failed.' }));
    socket.on('close', (code: number) => {
      if (runtime.socket === socket) runtime.socket = undefined;
      if (runtime.stopping || this.runtime !== runtime) return;
      if (code === 4002 || code === 4003) { runtime.stopping = true; runtime.publicState = remoteControlSessionSchema.parse({ ...runtime.publicState, status: code === 4002 ? 'expired' : 'error', lastError: code === 4003 ? 'The remote relay rejected the Desktop session.' : undefined }); this.emit(); return; }
      runtime.publicState = remoteControlSessionSchema.parse({ ...runtime.publicState, status: 'reconnecting' });
      this.emit();
      this.scheduleReconnect(runtime, sessionId);
    });
  }

  private scheduleReconnect(runtime: RemoteRuntimeSession, sessionId: string): void {
    if (runtime.reconnectTimer !== undefined || runtime.stopping) return;
    const delay = Math.min(MAX_RECONNECT_DELAY_MS, 1_000 * 2 ** runtime.reconnectAttempt++);
    runtime.reconnectTimer = setTimeout(() => { runtime.reconnectTimer = undefined; this.connect(runtime, sessionId); }, delay);
  }

  private async receive(runtime: RemoteRuntimeSession, socket: WebSocket, raw: string): Promise<void> {
    if (this.runtime !== runtime || runtime.socket !== socket) return;
    let value: unknown;
    try { value = JSON.parse(raw) as unknown; } catch { return; }
    if (isAuthAccepted(value) || isPeerKeyUpdated(value)) {
      const record = isRecord(value) ? value : undefined;
      const peerPublicKey = isAuthAccepted(value) ? readString(record ? record['peerPublicKey'] : undefined) : readString(record ? record['publicKey'] : undefined);
      if (peerPublicKey === undefined) return;
      try { runtime.cipher = createRemoteCipher(runtime.keyPair, peerPublicKey, runtime.publicState.sessionId); runtime.publicState = remoteControlSessionSchema.parse({ ...runtime.publicState, status: 'connected', lastError: undefined }); this.emit(); this.send(runtime, socket, 'host.ready', { at: new Date().toISOString() }); } catch (error) { this.options.logger.warn('remote-control.crypto.failed', { message: error instanceof Error ? error.message : 'Unable to establish encrypted remote session.' }); socket.close(4003, 'Remote encryption negotiation failed.'); }
      return;
    }
    const parsed = remoteEnvelopeSchema.safeParse(value);
    if (!parsed.success || parsed.data.sequence <= runtime.lastReceivedSequence) return;
    runtime.lastReceivedSequence = parsed.data.sequence;
    if (runtime.cipher === undefined) return;
    let message: { type: string; payload: unknown };
    try { message = runtime.cipher.decrypt(parsed.data as EncryptedRemoteEnvelope); } catch { socket.close(4004, 'Invalid encrypted remote message.'); return; }
    if (message.type !== 'command') return;
    const command = remoteCommandSchema.safeParse(message.payload);
    if (!command.success) { this.send(runtime, socket, 'command.error', { requestId: parsed.data.messageId, message: 'Remote command is invalid.' }); return; }
    const previous = runtime.requestLedger.get(parsed.data.messageId);
    const operation = previous ?? this.runCommand(runtime, parsed.data.messageId, command.data);
    if (previous === undefined) this.rememberRequest(runtime, parsed.data.messageId, operation);
    const response = await operation;
    if (this.runtime === runtime && runtime.socket === socket && !runtime.stopping) this.send(runtime, socket, response.type, response.payload);
  }

  private async executeCommand(runtime: RemoteRuntimeSession, command: RemoteCommand): Promise<unknown> {
    if (command.action === 'snapshot.request') return this.snapshot(command.taskId);
    if (command.action === 'task.create') {
      const workspace = await this.options.workspaces.require(command.workspaceId);
      return this.options.tasks.create({ workspaceId: workspace.id, cwd: workspace.rootPath, title: command.title.trim() || 'New chat' });
    }
    if (command.action === 'workspace.fileSuggestions') {
      const workspace = await this.options.workspaces.require(command.workspaceId);
      return this.options.workspaceFileSuggestions.list(workspace.rootPath, command.query);
    }
    if (command.action === 'prompt') return this.prompt(command.taskId, command.prompt, command.model, command.attachmentIds ?? []);
    if (command.action === 'attachment.start') return this.startAttachment(runtime, command);
    if (command.action === 'attachment.chunk') return this.receiveAttachmentChunk(runtime, command);
    if (command.action === 'attachment.complete') return this.completeAttachment(runtime, command.uploadId);
    if (command.action === 'attachment.abort') { runtime.uploads.delete(command.uploadId); this.scheduleUploadCleanup(runtime); return { aborted: true }; }
    if (command.action === 'cancel') return this.cancel(command.taskId);
    if (command.action === 'approval.respond') return this.options.approvals.respond(command.approvalId, command.approved, { ...(command.taskId === undefined ? {} : { taskId: command.taskId }), ...(command.sessionId === undefined ? {} : { sessionId: command.sessionId }) });
    if (command.action === 'trust.respond') { const cwd = await this.options.workspaces.requireRegisteredRoot(command.cwd); const result = await this.options.agents.trustRespond(cwd, { trustRequestId: command.trustRequestId, trusted: command.trusted }); this.pendingTrustRequests.delete(command.trustRequestId); return result; }
    const task = await this.options.tasks.require(command.taskId);
    const cwd = task.cwd;
    const commandList = await this.options.agents.commandList(cwd);
    if (!hasAllowedCommand(commandList, command.input.actionId)) throw new Error('The requested command is not available in this Desktop session.');
    return this.options.agents.commandExecute(cwd, command.input);
  }

  private async snapshot(taskId?: string): Promise<RemoteControlSnapshot> {
    const workspaces = await this.options.workspaces.list();
    const tasks = await this.options.tasks.list();
    const summaries = workspaces.map(workspace => remoteWorkspaceSummary(workspace, tasks.filter(task => task.workspaceId === workspace.id).slice(0, MAX_TASKS_PER_WORKSPACE)));
    const approvals = this.options.approvals.listPending().map(request => sanitizeValue(request) as DesktopApprovalRequest);
    const trustRequests = [...this.pendingTrustRequests.values()].map(request => ({ ...request }));
    if (taskId === undefined) return { generatedAt: new Date().toISOString(), workspaces: summaries, approvals, trustRequests };
    const task = await this.options.tasks.require(taskId);
    const activities = (await this.options.tasks.activitiesPage(task.id, { limit: MAX_ACTIVITY_ITEMS })).activities.map(item => ({ ...item, text: limitText(item.text), metadata: sanitizeValue(item.metadata) as Record<string, unknown> }));
    const [commands, models, artifacts] = await Promise.all([this.options.agents.commandList(task.cwd).catch(() => undefined), this.options.agents.modelList(task.cwd).catch(() => undefined), this.options.artifacts.list(task.id).catch(() => [])]);
    const attachmentByActivity = Object.fromEntries(activities.flatMap(activity => {
      const ids = Array.isArray(activity.metadata['attachmentIds']) ? activity.metadata['attachmentIds'].filter((id): id is string => typeof id === 'string') : [];
      const items = ids.flatMap(id => { const artifact = artifacts.find(candidate => candidate.id === id); return artifact === undefined ? [] : [{ id: artifact.id, name: artifact.name, kind: artifact.kind, size: artifact.size }]; });
      return items.length === 0 ? [] : [[activity.id, items] as const];
    }));
    return { generatedAt: new Date().toISOString(), workspaces: summaries, approvals, trustRequests, task: { task: remoteTaskSummary(task), activities, commands: readCommands(commands), models: readModels(models), attachments: attachmentByActivity } };
  }

  private async prompt(taskId: string, prompt: string, model?: string, attachmentIds: string[] = []): Promise<unknown> {
    const task = await this.options.tasks.require(taskId);
    if (task.archived) throw new Error('The selected task is archived.');
    await this.options.artifacts.attachmentInputs(task.id, attachmentIds);
    if (task.status === 'active' && task.turnId !== undefined) {
      const queue = this.queuedPrompts.get(taskId) ?? [];
      if (queue.length >= MAX_QUEUED_PROMPTS_PER_TASK) throw new Error('This task already has the maximum number of queued remote prompts.');
      await this.options.tasks.appendActivity(task.id, 'user', prompt, { remote: true, queued: true, ...(attachmentIds.length === 0 ? {} : { attachmentIds }) });
      queue.push({ taskId, prompt, attachmentIds, ...(model === undefined ? {} : { model }) }); this.queuedPrompts.set(taskId, queue);
      return { queued: true, position: queue.length };
    }
    return this.startPrompt(task.id, prompt, model, attachmentIds);
  }

  private async startPrompt(taskId: string, prompt: string, model?: string, attachmentIds: string[] = []): Promise<unknown> {
    const task = await this.options.tasks.require(taskId);
    if (task.archived) throw new Error('The selected task is archived.');
    const attachments = await this.options.artifacts.attachmentInputs(task.id, attachmentIds);
    let sessionId = task.sessionId;
    if (sessionId === undefined) {
      const initialized = await this.options.agents.initialize(task.cwd);
      if (!initialized) throw new Error('The Desktop agent handshake failed.');
      const created = await this.options.agents.sessionCreate(task.cwd, { name: task.title });
      sessionId = readString((readRecord(created)?.['session'] as Record<string, unknown> | undefined)?.['id']);
      if (sessionId === undefined) throw new Error('The CLI did not return a session id.');
      await this.options.tasks.update(task.id, { sessionId });
    }
    if (task.sessionId === undefined) await this.options.tasks.update(task.id, { sessionId });
    if (model !== undefined && task.model !== model) await this.options.tasks.update(task.id, { model });
    await this.options.tasks.appendActivity(task.id, 'user', prompt, { remote: true, ...(attachmentIds.length === 0 ? {} : { attachmentIds }) });
    try {
      const result = await this.options.agents.turnStart(task.cwd, { sessionId, prompt, taskId: task.id, ...(model === undefined ? {} : { model }), ...(attachments.length === 0 ? {} : { attachments }) });
      const turnId = readString(readRecord(result)?.['turnId']);
      if (turnId !== undefined) await this.options.tasks.update(task.id, { turnId });
      return { accepted: true, ...(turnId === undefined ? {} : { turnId }) };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Remote turn failed to start.';
      await this.options.tasks.appendActivity(task.id, 'error', message, { remote: true }).catch(() => undefined);
      await this.options.tasks.setStatus(task.id, 'failed').catch(() => undefined);
      throw error;
    }
  }

  private async drainQueuedPrompts(taskId: string): Promise<void> {
    if (this.drainingTasks.has(taskId)) return;
    this.drainingTasks.add(taskId);
    try {
      const task = await this.options.tasks.require(taskId).catch(() => undefined);
      const queue = this.queuedPrompts.get(taskId);
      if (task === undefined || queue === undefined || queue.length === 0 || task.status === 'active' || task.turnId !== undefined) return;
      const next = queue.shift();
      if (queue.length === 0) this.queuedPrompts.delete(taskId); else this.queuedPrompts.set(taskId, queue);
      if (next !== undefined) await this.startPrompt(next.taskId, next.prompt, next.model, next.attachmentIds).catch(error => this.options.tasks.appendActivity(taskId, 'error', error instanceof Error ? error.message : 'Queued remote prompt failed.', { remote: true, queued: true }).catch(() => undefined));
    } finally { this.drainingTasks.delete(taskId); }
  }

  private async startAttachment(runtime: RemoteRuntimeSession, command: Extract<RemoteCommand, { action: 'attachment.start' }>): Promise<unknown> {
    this.cleanupExpiredUploads(runtime);
    if (runtime.uploads.size + runtime.uploadStartReservations >= 2) throw new Error('The maximum number of simultaneous remote uploads has been reached.');
    if (command.sizeBytes > REMOTE_ATTACHMENT_MAX_BYTES) throw new Error('The remote attachment exceeds the supported size limit.');
    const expectedChunks = Math.ceil(command.sizeBytes / REMOTE_ATTACHMENT_CHUNK_BYTES);
    if (command.chunkCount !== expectedChunks) throw new Error('The remote attachment chunk count is invalid.');
    runtime.uploadStartReservations += 1;
    try {
      const task = await this.options.tasks.require(command.taskId);
      if (task.archived) throw new Error('The selected task is archived.');
      const uploadId = randomUUID();
      runtime.uploads.set(uploadId, { uploadId, taskId: command.taskId, name: command.name, mimeType: command.mimeType, sizeBytes: command.sizeBytes, chunkCount: command.chunkCount, chunks: new Map(), receivedBytes: 0, expiresAt: Date.now() + REMOTE_UPLOAD_TTL_MS });
      this.scheduleUploadCleanup(runtime);
      return { uploadId, chunkSize: REMOTE_ATTACHMENT_CHUNK_BYTES };
    } finally { runtime.uploadStartReservations -= 1; }
  }

  private receiveAttachmentChunk(runtime: RemoteRuntimeSession, command: Extract<RemoteCommand, { action: 'attachment.chunk' }>): unknown {
    this.cleanupExpiredUploads(runtime);
    const upload = runtime.uploads.get(command.uploadId);
    if (upload === undefined) throw new Error('The remote attachment upload was not found or has expired.');
    if (command.index >= upload.chunkCount) throw new Error('The remote attachment chunk index is invalid.');
    const bytes = decodeBase64Url(command.bytes);
    if (bytes.byteLength > REMOTE_ATTACHMENT_CHUNK_BYTES) throw new Error('The remote attachment chunk is too large.');
    const existing = upload.chunks.get(command.index);
    if (existing === undefined) { if (upload.receivedBytes + bytes.byteLength > upload.sizeBytes) throw new Error('The remote attachment exceeds its declared size.'); upload.chunks.set(command.index, bytes); upload.receivedBytes += bytes.byteLength; }
    else if (!existing.equals(bytes)) throw new Error('The remote attachment chunk was uploaded twice with different contents.');
    upload.expiresAt = Date.now() + REMOTE_UPLOAD_TTL_MS;
    this.scheduleUploadCleanup(runtime);
    return { uploadId: upload.uploadId, receivedChunks: upload.chunks.size, chunkCount: upload.chunkCount, receivedBytes: upload.receivedBytes };
  }

  private async completeAttachment(runtime: RemoteRuntimeSession, uploadId: string): Promise<unknown> {
    this.cleanupExpiredUploads(runtime);
    const upload = runtime.uploads.get(uploadId);
    if (upload === undefined) throw new Error('The remote attachment upload was not found or has expired.');
    if (upload.completion !== undefined) return upload.completion;
    if (upload.chunks.size !== upload.chunkCount || upload.receivedBytes !== upload.sizeBytes) throw new Error('The remote attachment is incomplete.');
    upload.completion = (async () => {
      const bytes = Buffer.concat(Array.from({ length: upload.chunkCount }, (_, index) => upload.chunks.get(index)!));
      const artifact = upload.mimeType.toLowerCase().startsWith('image/') ? await this.options.artifacts.createImage(upload.taskId, upload.name, bytes) : await this.options.artifacts.createBinary(upload.taskId, upload.name, bytes);
      runtime.uploads.delete(uploadId);
      this.scheduleUploadCleanup(runtime);
      return { attachmentId: artifact.id, name: artifact.name, sizeBytes: artifact.size, kind: artifact.kind };
    })();
    return upload.completion;
  }

  private cleanupExpiredUploads(runtime: RemoteRuntimeSession): void { const now = Date.now(); for (const [uploadId, upload] of runtime.uploads) if (upload.expiresAt <= now) runtime.uploads.delete(uploadId); }
  private scheduleUploadCleanup(runtime: RemoteRuntimeSession): void {
    if (runtime.uploads.size === 0) { if (runtime.uploadCleanupTimer !== undefined) clearTimeout(runtime.uploadCleanupTimer); runtime.uploadCleanupTimer = undefined; return; }
    if (runtime.uploadCleanupTimer !== undefined) return;
    runtime.uploadCleanupTimer = setTimeout(() => { runtime.uploadCleanupTimer = undefined; this.cleanupExpiredUploads(runtime); this.scheduleUploadCleanup(runtime); }, REMOTE_UPLOAD_CLEANUP_INTERVAL_MS);
    runtime.uploadCleanupTimer.unref?.();
  }

  private trackTrustRequest(cwd: string, event: DesktopEvent): void {
    if (event.event === 'trust.requested') {
      const trustRequestId = readString(event.data['trustRequestId']);
      const taskId = readString(event.data['taskId']);
      const sessionId = readString(event.data['sessionId']);
      const path = readString(event.data['path']);
      if (trustRequestId && taskId && sessionId && path) { this.pendingTrustRequests.delete(trustRequestId); this.pendingTrustRequests.set(trustRequestId, { trustRequestId, taskId, sessionId, path, cwd }); if (this.pendingTrustRequests.size > MAX_PENDING_TRUST_REQUESTS) this.pendingTrustRequests.delete(this.pendingTrustRequests.keys().next().value as string); }
    }
    if (event.event === 'trust.resolved' || event.event === 'trust.responded') { const trustRequestId = readString(event.data['trustRequestId']); if (trustRequestId) this.pendingTrustRequests.delete(trustRequestId); }
  }

  private runCommand(runtime: RemoteRuntimeSession, messageId: string, command: RemoteCommand): Promise<RemoteResponse> {
    return this.executeCommand(runtime, command).then(result => ({ type: 'command.result', payload: { requestId: messageId, result: sanitizeValue(result) } }), error => ({ type: 'command.error', payload: { requestId: messageId, message: error instanceof Error ? error.message : 'Remote command failed.' } }));
  }

  private rememberRequest(runtime: RemoteRuntimeSession, messageId: string, operation: Promise<RemoteResponse>): void {
    runtime.requestLedger.set(messageId, operation);
    if (runtime.requestLedger.size > MAX_ACTIVITY_ITEMS) runtime.requestLedger.delete(runtime.requestLedger.keys().next().value as string);
  }

  private async cancel(taskId: string): Promise<unknown> {
    const task = await this.options.tasks.require(taskId);
    if (task.turnId === undefined) return { cancelled: false };
    return this.options.agents.turnCancel(task.cwd, task.turnId);
  }

  private sendCurrent(type: string, payload: unknown): void { const runtime = this.runtime; if (runtime?.socket !== undefined) this.send(runtime, runtime.socket, type, payload); }
  private send(runtime: RemoteRuntimeSession, socket: WebSocket, type: string, payload: unknown): void {
    if (runtime.cipher === undefined) return;
    const sequence = runtime.nextSequence++;
    runtime.sendChain = runtime.sendChain.catch(() => undefined).then(() => {
      if (this.runtime !== runtime || runtime.stopping || runtime.socket !== socket || socket.readyState !== WebSocket.OPEN || runtime.cipher === undefined) return;
      const envelope = runtime.cipher.encrypt(type, sanitizeValue(payload), randomUUID(), sequence);
      try { socket.send(JSON.stringify(envelope)); } catch (error) { this.options.logger.warn('remote-control.socket.send.failed', { message: error instanceof Error ? error.message : 'Remote socket send failed.' }); socket.terminate(); }
    });
  }

  private isConnected(): boolean { return this.runtime?.socket?.readyState === WebSocket.OPEN; }
  private emit(event?: RemoteControlStateEvent): void { const next = event ?? { type: 'state' as const, session: this.runtime?.publicState ?? null }; for (const listener of this.listeners) listener(next); }
  private emitState(patch: Partial<RemoteControlSession>): void { this.emit({ type: 'state', session: patch.status === 'creating' ? null : this.runtime === undefined ? null : remoteControlSessionSchema.parse({ ...this.runtime.publicState, ...patch }) }); }
  private expire(): void { const runtime = this.runtime; if (runtime === undefined) return; runtime.stopping = true; runtime.socket?.close(4002, 'Remote session expired.'); runtime.publicState = remoteControlSessionSchema.parse({ ...runtime.publicState, status: 'expired' }); this.emit(); }
  private clearRuntimeTimers(runtime: RemoteRuntimeSession): void { if (runtime.reconnectTimer !== undefined) clearTimeout(runtime.reconnectTimer); if (runtime.expiryTimer !== undefined) clearTimeout(runtime.expiryTimer); if (runtime.uploadCleanupTimer !== undefined) clearTimeout(runtime.uploadCleanupTimer); runtime.reconnectTimer = undefined; runtime.expiryTimer = undefined; runtime.uploadCleanupTimer = undefined; }
  private clearRuntime(): void { if (this.runtime !== undefined) { this.runtime.stopping = true; this.clearRuntimeTimers(this.runtime); this.runtime.socket?.close(); this.runtime.uploads.clear(); this.runtime.requestLedger.clear(); } this.runtime = undefined; this.queuedPrompts.clear(); this.drainingTasks.clear(); this.pendingTrustRequests.clear(); }
}

function normalizeServerUrl(value: string): string | undefined { const trimmed = value.trim().replace(/\/$/u, ''); if (!trimmed) return undefined; try { const url = new URL(trimmed); if (!['http:', 'https:'].includes(url.protocol)) return undefined; return url.toString().replace(/\/$/u, ''); } catch { return undefined; } }
function parseServerSession(value: unknown): RemoteServerSessionResponse { if (!isRecord(value) || !isNonEmptyString(value['sessionId']) || !isNonEmptyString(value['hostToken']) || !isNonEmptyString(value['pairingToken']) || !isNonEmptyString(value['expiresAt']) || !isNonEmptyString(value['connectUrl'])) throw new Error('Remote server returned an invalid session.'); return value as unknown as RemoteServerSessionResponse; }
function isAuthAccepted(value: unknown): boolean { return isRecord(value) && value['type'] === 'auth.accepted'; }
function isPeerKeyUpdated(value: unknown): boolean { return isRecord(value) && value['type'] === 'peer.key.updated'; }
function workspaceKey(cwd: string): string { return cwd.replace(/\\/gu, '/').split('/').at(-1) ?? 'workspace'; }
function sanitizeValue(value: unknown, depth = 0): unknown { if (typeof value === 'string') return limitText(value); if (depth > 5) return '[truncated]'; if (Array.isArray(value)) return value.slice(0, 100).map(item => sanitizeValue(item, depth + 1)); if (!isRecord(value)) return value; return Object.fromEntries(Object.entries(value).slice(0, 100).map(([key, item]) => [key, /(?:token|secret|password|authorization|cookie|api[-_]?key|private[-_]?key)/iu.test(key) ? '[redacted]' : sanitizeValue(item, depth + 1)])); }
function limitText(value: string): string { return value.length > 16_384 ? `${value.slice(0, 16_384)}…` : value; }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function isNonEmptyString(value: unknown): value is string { return typeof value === 'string' && value.length > 0; }
function readRecord(value: unknown): Record<string, unknown> | undefined { return isRecord(value) ? value : undefined; }
function readString(value: unknown): string | undefined { return isNonEmptyString(value) ? value : undefined; }
function readModels(value: unknown): Array<{ id: string; label: string }> {
  const list = isRecord(value) && Array.isArray(value['models']) ? value['models'] : [];
  return list.flatMap(item => {
    if (typeof item === 'string' && item.length > 0) return [{ id: item, label: item }];
    if (!isRecord(item) || typeof item['id'] !== 'string' || item['id'].length === 0) return [];
    return [{ id: item['id'], label: typeof item['label'] === 'string' && item['label'].length > 0 ? item['label'] : item['id'] }];
  }).slice(0, 100);
}
function readCommands(value: unknown): Array<{ id: string; path: string[]; summary: string }> {
  const list = isRecord(value) && Array.isArray(value['commands']) ? value['commands'] : [];
  return list.flatMap(item => {
    if (!isRecord(item) || typeof item['id'] !== 'string' || !Array.isArray(item['path']) || item['path'].some(part => typeof part !== 'string') || typeof item['summary'] !== 'string') return [];
    return [{ id: item['id'], path: item['path'] as string[], summary: item['summary'] }];
  }).slice(0, 100);
}
function hasAllowedCommand(value: unknown, actionId: unknown): boolean { const commands = readRecord(value)?.['commands']; return typeof actionId === 'string' && Array.isArray(commands) && commands.some(item => readRecord(item)?.['id'] === actionId); }
function decodeBase64Url(value: string): Buffer {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) throw new Error('The remote attachment chunk encoding is invalid.');
  const bytes = Buffer.from(value, 'base64url');
  if (bytes.length === 0 || bytes.toString('base64url') !== value) throw new Error('The remote attachment chunk encoding is invalid.');
  return bytes;
}
async function fetchWithTimeout(input: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try { return await fetch(input, { ...init, signal: controller.signal }); }
  finally { clearTimeout(timer); }
}
