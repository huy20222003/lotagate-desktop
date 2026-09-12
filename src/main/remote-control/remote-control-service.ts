import { randomUUID } from 'node:crypto';
import { WebSocket } from 'ws';
import { createRemoteCipher, createRemoteKeyPair, type EncryptedRemoteEnvelope, type RemoteCipher, type RemoteKeyPair } from './remote-control-crypto.js';
import { REMOTE_ATTACHMENT_CHUNK_BYTES, REMOTE_ATTACHMENT_MAX_BYTES, REMOTE_MEDIA_READ_CHUNK_BYTES, remoteCommandSchema, remoteControlSessionSchema, remoteEnvelopeSchema, remoteTaskSummary, remoteWorkspaceSummary, type RemoteCommand, type RemoteCommandDescriptor, type RemoteControlSession, type RemoteControlSnapshot, type RemoteControlStateEvent, type RemoteTrustRequest } from '../../contracts/remote-control/v1/remote-control.js';
import { MAX_QUEUED_PROMPTS_PER_TASK } from '../../contracts/ipc/v1/workspace.js';
import { REMOTE_SLASH_COMMAND_DEFINITIONS } from '../../contracts/remote-control/v1/slash-command-catalog.js';
import type { DesktopEvent } from '../../contracts/agent-protocol/v1/desktop.js';
import type { DesktopApprovalRequest, DesktopApprovalResolution } from '../../contracts/ipc/v1/approval.js';
import type { AutomationStateEvent } from '../../contracts/ipc/v1/automation.js';
import type { TaskStore } from '../tasks/task-store.js';
import type { TaskTurnCoordinator } from '../tasks/task-turn-coordinator.js';
import type { WorkspaceRegistry } from '../workspaces/workspace-registry.js';
import type { AgentManager } from '../agents/agent-manager.js';
import type { ApprovalCoordinator } from '../approvals/approval-coordinator.js';
import type { DesktopLogger } from '../observability/desktop-logger.js';
import type { ArtifactService } from '../artifacts/artifact-service.js';
import { artifactKind } from '../artifacts/artifact-kind.js';
import type { WorkspaceFileSuggestions } from '../workspaces/workspace-file-suggestions.js';
import type { SettingsService } from '../settings/settings-service.js';
import { DESKTOP_RUNTIME_LIMITS } from '../../contracts/runtime-limits.js';
import { normalizeRemoteServerGlobalPrefix, remoteServerRoute } from './remote-server-paths.js';
import { MAX_ACTIVITY_ITEMS, MAX_PENDING_TRUST_REQUESTS, MAX_RECONNECT_DELAY_MS, MAX_TASKS_PER_WORKSPACE, MAX_TIMER_DELAY_MS, RECONNECT_STABLE_MS, REMOTE_REQUEST_TIMEOUT_MS, REMOTE_UPLOAD_CLEANUP_INTERVAL_MS, REMOTE_UPLOAD_TTL_MS } from './remote-control-constants.js';

interface RemoteServerSessionResponse { sessionId: string; hostToken: string; pairingToken: string; expiresAt: string; connectUrl: string }
interface RemoteRuntimeSession { publicState: RemoteControlSession; hostToken: string; socket: WebSocket | undefined; keyPair: RemoteKeyPair; cipher: RemoteCipher | undefined; sendChain: Promise<void>; sendQueueEntries: number; sendQueueBytes: number; nextSequence: number; lastReceivedSequence: number; reconnectAttempt: number; stopping: boolean; reconnectTimer: ReturnType<typeof setTimeout> | undefined; reconnectStableTimer: ReturnType<typeof setTimeout> | undefined; expiryTimer: ReturnType<typeof setTimeout> | undefined; uploadCleanupTimer: ReturnType<typeof setTimeout> | undefined; uploadStartReservations: number; uploads: Map<string, RemoteUpload>; requestLedger: Map<string, Promise<RemoteResponse>> }
interface RemoteResponse { type: 'command.result' | 'command.error'; payload: Record<string, unknown> }
interface RemoteUpload { uploadId: string; taskId: string; name: string; mimeType: string; sizeBytes: number; chunkCount: number; chunks: Map<number, Buffer>; receivedBytes: number; expiresAt: number; completion?: Promise<unknown> }

export class RemoteControlService {
  private runtime: RemoteRuntimeSession | undefined;
  private readonly listeners = new Set<(event: RemoteControlStateEvent) => void>();
  private readonly pendingTrustRequests = new Map<string, RemoteTrustRequest>();
  private readonly drainingTasks = new Set<string>();

  constructor(private readonly options: { serverUrl: string; globalPrefix: string; enrollmentToken?: string; tasks: TaskStore; taskTurns?: TaskTurnCoordinator; workspaces: WorkspaceRegistry; workspaceFileSuggestions: WorkspaceFileSuggestions; agents: AgentManager; approvals: ApprovalCoordinator; artifacts: ArtifactService; settings: SettingsService; logger: DesktopLogger }) {}

  get(): RemoteControlSession | null { return this.runtime?.publicState ?? null; }
  onState(listener: (event: RemoteControlStateEvent) => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }

  async create(): Promise<RemoteControlSession> {
    if (this.runtime !== undefined && !['expired', 'revoked', 'error'].includes(this.runtime.publicState.status)) return this.runtime.publicState;
    const serverUrl = normalizeServerUrl(this.options.serverUrl);
    if (serverUrl === undefined) throw new Error('Configure LOTAGATE_REMOTE_SERVER_URL before starting Remote Control.');
    const globalPrefix = normalizeRemoteServerGlobalPrefix(this.options.globalPrefix);
    if (globalPrefix === undefined) throw new Error('Configure LOTAGATE_REMOTE_SERVER_GLOBAL_PREFIX before starting Remote Control.');
    this.clearRuntime();
    this.emitState({ status: 'creating' });
    const enrollmentToken = this.options.enrollmentToken?.trim();
    if (!enrollmentToken) throw new Error('Configure LOTAGATE_REMOTE_SERVER_ENROLLMENT_TOKEN before starting Remote Control.');
    const response = await fetchWithTimeout(`${serverUrl}${remoteServerRoute(globalPrefix, '/sessions')}`, { method: 'POST', headers: { Accept: 'application/json', 'X-LotaGate-Desktop-Token': enrollmentToken } }, REMOTE_REQUEST_TIMEOUT_MS);
    if (!response.ok) throw new Error(`Remote server could not create a session (HTTP ${response.status}).`);
    const value = parseServerSession(await response.json());
    const publicState = remoteControlSessionSchema.parse({ sessionId: value.sessionId, connectUrl: value.connectUrl, expiresAt: value.expiresAt, status: 'connecting' });
    const runtime: RemoteRuntimeSession = { publicState, hostToken: value.hostToken, socket: undefined, keyPair: createRemoteKeyPair(), cipher: undefined, sendChain: Promise.resolve(), sendQueueEntries: 0, sendQueueBytes: 0, nextSequence: 0, lastReceivedSequence: -1, reconnectAttempt: 0, stopping: false, reconnectTimer: undefined, reconnectStableTimer: undefined, expiryTimer: undefined, uploadCleanupTimer: undefined, uploadStartReservations: 0, uploads: new Map(), requestLedger: new Map() };
    this.runtime = runtime;
    this.scheduleExpiry(runtime, value.expiresAt);
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
    const globalPrefix = normalizeRemoteServerGlobalPrefix(this.options.globalPrefix);
    if (serverUrl !== undefined && globalPrefix !== undefined) await fetchWithTimeout(`${serverUrl}${remoteServerRoute(globalPrefix, `/sessions/${encodeURIComponent(runtime.publicState.sessionId)}`)}`, { method: 'DELETE', headers: { Authorization: `Bearer ${runtime.hostToken}` } }, REMOTE_REQUEST_TIMEOUT_MS).catch(() => undefined);
    runtime.publicState = remoteControlSessionSchema.parse({ ...runtime.publicState, status: 'revoked' });
    this.emit();
  }

  async stop(): Promise<void> { await this.revoke(); this.clearRuntime(); }

  publishAgentEvent(cwd: string, event: DesktopEvent): void {
    this.trackTrustRequest(cwd, event);
    if (!this.isConnected()) return;
    this.sendCurrent('event', { source: 'agent', cwd: workspaceKey(cwd), event: sanitizeValue(event) }, 'best-effort');
  }

  observeAgentEvent(event: DesktopEvent): void {
    const taskId = readString(event.data['taskId']);
    if (event.event === 'turn.completed' || event.event === 'turn.failed' || event.event === 'turn.cancelled') {
      if (taskId !== undefined) scheduleQueueDrain(() => this.drainQueuedPrompts(taskId));
      else void this.options.tasks.findBySession(readString(event.data['sessionId']) ?? '').then(task => { if (task) scheduleQueueDrain(() => this.drainQueuedPrompts(task.id)); }).catch(() => undefined);
    }
    if (event.event === 'trust.resolved' || event.event === 'trust.responded') {
      const trustRequestId = readString(event.data['trustRequestId']);
      if (trustRequestId !== undefined) this.pendingTrustRequests.delete(trustRequestId);
    }
  }

  publishApprovalRequest(request: DesktopApprovalRequest): void { if (this.isConnected()) this.sendCurrent('approval.requested', sanitizeValue(request)); }
  publishApprovalResolution(resolution: DesktopApprovalResolution): void { if (this.isConnected()) this.sendCurrent('approval.resolved', sanitizeValue(resolution)); }
  publishAutomationState(event: AutomationStateEvent): void { if (this.isConnected()) this.sendCurrent('automation.state', sanitizeValue(event), 'best-effort'); }

  private connect(runtime: RemoteRuntimeSession, sessionId: string): void {
    const serverUrl = normalizeServerUrl(this.options.serverUrl);
    const globalPrefix = normalizeRemoteServerGlobalPrefix(this.options.globalPrefix);
    if (serverUrl === undefined || globalPrefix === undefined || runtime.stopping || this.runtime !== runtime) return;
    const url = new URL(`${serverUrl}${remoteServerRoute(globalPrefix, '/ws')}`);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.searchParams.set('session', sessionId);
    url.searchParams.set('role', 'host');
    const socket = new WebSocket(url);
    runtime.socket = socket;
    socket.on('open', () => {
      if (this.runtime !== runtime || runtime.socket !== socket) return;
      if (runtime.reconnectStableTimer !== undefined) clearTimeout(runtime.reconnectStableTimer);
      runtime.reconnectStableTimer = setTimeout(() => { if (runtime.socket === socket && socket.readyState === WebSocket.OPEN) runtime.reconnectAttempt = 0; }, RECONNECT_STABLE_MS);
      runtime.cipher = undefined;
      runtime.publicState = remoteControlSessionSchema.parse({ ...runtime.publicState, status: 'connecting', lastError: undefined });
      this.emit();
      socket.send(JSON.stringify({ version: 1, type: 'auth', sessionId, role: 'host', credential: runtime.hostToken, publicKey: runtime.keyPair.publicKey }));
    });
    socket.on('message', data => { void this.receive(runtime, socket, data.toString('utf8')); });
    socket.on('error', error => this.options.logger.warn('remote-control.socket.error', { message: error instanceof Error ? error.message : 'Remote socket failed.' }));
    socket.on('close', (code: number) => {
      if (runtime.socket !== socket) return;
      runtime.socket = undefined;
      runtime.cipher = undefined;
      if (runtime.reconnectStableTimer !== undefined) clearTimeout(runtime.reconnectStableTimer);
      runtime.reconnectStableTimer = undefined;
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
      if (peerPublicKey === undefined) {
        if (isAuthAccepted(value)) {
          runtime.publicState = remoteControlSessionSchema.parse({ ...runtime.publicState, status: 'connected', lastError: undefined });
          this.emit();
        }
        return;
      }
      try { if (isPeerKeyUpdated(value)) runtime.lastReceivedSequence = -1; runtime.cipher = createRemoteCipher(runtime.keyPair, peerPublicKey, runtime.publicState.sessionId); runtime.publicState = remoteControlSessionSchema.parse({ ...runtime.publicState, status: 'connected', lastError: undefined }); this.emit(); this.send(runtime, socket, 'host.ready', { at: new Date().toISOString() }); } catch (error) { this.options.logger.warn('remote-control.crypto.failed', { message: error instanceof Error ? error.message : 'Unable to establish encrypted remote session.' }); socket.close(4003, 'Remote encryption negotiation failed.'); }
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
    if (command.action === 'prompt') return this.prompt(command.taskId, command.prompt, command.model, command.attachmentIds ?? [], command.skills ?? [], command.agentPrompt);
    if (command.action === 'attachment.start') return this.startAttachment(runtime, command);
    if (command.action === 'attachment.chunk') return this.receiveAttachmentChunk(runtime, command);
    if (command.action === 'attachment.complete') return this.completeAttachment(runtime, command.uploadId);
    if (command.action === 'attachment.abort') { runtime.uploads.delete(command.uploadId); this.scheduleUploadCleanup(runtime); return { aborted: true }; }
    if (command.action === 'artifact.read') return this.readArtifactChunk(command);
    if (command.action === 'cancel') return this.cancel(command.taskId);
    if (command.action === 'approval.respond') return this.options.approvals.respond(command.approvalId, command.approved, { ...(command.taskId === undefined ? {} : { taskId: command.taskId }), ...(command.sessionId === undefined ? {} : { sessionId: command.sessionId }) });
    if (command.action === 'trust.respond') { const cwd = await this.options.workspaces.requireRegisteredRoot(command.cwd); const result = await this.options.agents.trustRespond(cwd, { trustRequestId: command.trustRequestId, trusted: command.trusted }); this.pendingTrustRequests.delete(command.trustRequestId); return result; }
    const task = await this.options.tasks.require(command.taskId);
    const cwd = task.cwd;
    const commandList = await this.options.agents.commandList(cwd);
    if (!hasAllowedCommand(commandList, command.input.actionId) || !REMOTE_SLASH_COMMAND_DEFINITIONS.some(definition => definition.id === command.input.actionId)) throw new Error('The requested command is not available through Remote Control.');
    const input = command.input.attachments === undefined ? command.input : { ...command.input, options: await this.resolveRemoteCommandOptions(task.id, command.input.options as Record<string, string | boolean>, command.input.attachments) };
    return this.options.agents.commandExecute(cwd, input);
  }

  private async snapshot(taskId?: string): Promise<RemoteControlSnapshot> {
    const workspaces = await this.options.workspaces.list();
    const tasks = await this.options.tasks.list();
    const summaries = workspaces.map(workspace => remoteWorkspaceSummary(workspace, tasks.filter(task => task.workspaceId === workspace.id).sort(compareTaskSidebarOrder).slice(0, MAX_TASKS_PER_WORKSPACE)));
    const approvals = this.options.approvals.listPending().map(request => sanitizeValue(request) as DesktopApprovalRequest);
    const trustRequests = [...this.pendingTrustRequests.values()].map(request => ({ ...request }));
    if (taskId === undefined) return { generatedAt: new Date().toISOString(), workspaces: summaries, approvals, trustRequests };
    const task = await this.options.tasks.require(taskId);
    const activities = (await this.options.tasks.activitiesPage(task.id, { limit: MAX_ACTIVITY_ITEMS })).activities.map(item => ({ ...item, text: limitText(item.text), metadata: sanitizeValue(item.metadata) as Record<string, unknown> }));
    const [commands, skills, models, artifacts] = await Promise.all([this.options.agents.commandList(task.cwd).catch(() => undefined), this.options.agents.commandExecuteResult(task.cwd, { actionId: 'skill.list', positionals: [], options: {} }).catch(() => undefined), this.options.agents.modelList(task.cwd).catch(() => undefined), this.options.artifacts.list(task.id).catch(() => [])]);
    const attachmentByActivity = Object.fromEntries(activities.flatMap(activity => {
      const ids = [...readStringArray(activity.metadata['attachmentIds']), ...readStringArray(activity.metadata['artifactIds'])];
      const items = ids.flatMap(id => { const artifact = artifacts.find(candidate => candidate.id === id); return artifact === undefined ? [] : [{ id: artifact.id, name: artifact.name, kind: artifact.kind, size: artifact.size }]; });
      return items.length === 0 ? [] : [[activity.id, items] as const];
    }));
    const commandDescriptors = readCommands(commands);
    const remoteModels = readModels(models);
    const showContextWindowUsage = (await this.options.settings.get()).showContextWindowUsage === true;
    const selectedModel = task.model ?? remoteModels[0]?.id;
    const contextUsage = showContextWindowUsage ? readLatestContextUsage(activities, remoteModels, selectedModel) ?? defaultContextUsage(remoteModels, selectedModel) : undefined;
    return { generatedAt: new Date().toISOString(), workspaces: summaries, approvals, trustRequests, task: { task: remoteTaskSummary(task), activities, commands: mergeRemoteCommandDescriptors(commandDescriptors), skills: readSkills(skills), models: remoteModels, ...(showContextWindowUsage ? { showContextWindowUsage: true } : {}), ...(contextUsage === undefined || !showContextWindowUsage ? {} : { contextUsage }), attachments: attachmentByActivity } };
  }

  private async resolveRemoteCommandOptions(taskId: string, options: Record<string, string | boolean>, attachments: Record<string, string[]>): Promise<Record<string, string | boolean>> {
    const resolved = { ...options };
    for (const [name, ids] of Object.entries(attachments)) {
      const inputs = await this.options.artifacts.attachmentInputs(taskId, ids);
      resolved[name] = inputs.map(input => input.path).join(',');
    }
    return resolved;
  }

  private async readArtifactChunk(command: Extract<RemoteCommand, { action: 'artifact.read' }>): Promise<unknown> {
    const result = await this.options.artifacts.readMediaChunk(command.taskId, command.artifactId, command.offset, command.length);
    return { artifact: { id: result.artifact.id, name: result.artifact.name, kind: result.artifact.kind, size: result.artifact.size }, mimeType: result.mimeType, offset: command.offset, totalBytes: result.artifact.size, bytes: Buffer.from(result.bytes).toString('base64url'), done: command.offset + result.bytes.byteLength >= result.artifact.size };
  }

  private async prompt(taskId: string, prompt: string, model?: string, attachmentIds: string[] = [], skills: string[] = [], agentPrompt?: string): Promise<unknown> {
    const task = await this.options.tasks.require(taskId);
    if (task.archived) throw new Error('The selected task is archived.');
    await this.options.artifacts.attachmentInputs(task.id, attachmentIds);
    if (task.status === 'active' && task.turnId !== undefined) {
      const queue = await this.options.tasks.queuedPrompts(taskId);
      if (queue.length >= MAX_QUEUED_PROMPTS_PER_TASK) throw new Error('This task already has the maximum number of queued remote prompts.');
      await this.options.tasks.appendActivity(task.id, 'user', prompt, { remote: true, queued: true, ...(attachmentIds.length === 0 ? {} : { attachmentIds }) });
      await this.options.tasks.queuePrompt(task.id, { prompt, skills, attachmentIds, ...(agentPrompt === undefined ? {} : { agentPrompt }), ...(model === undefined ? {} : { model }) });
      return { queued: true, position: queue.length + 1 };
    }
    return this.startPrompt(task.id, prompt, model, attachmentIds, skills, agentPrompt);
  }

  private async startPrompt(taskId: string, prompt: string, model?: string, attachmentIds: string[] = [], skills: string[] = [], agentPrompt?: string): Promise<unknown> {
    const task = await this.options.tasks.require(taskId);
    if (task.archived) throw new Error('The selected task is archived.');
    const claimToken = this.options.taskTurns?.claim(task.id, task.cwd);
    let attachments: Awaited<ReturnType<ArtifactService['attachmentInputs']>>;
    try { attachments = await this.options.artifacts.attachmentInputs(task.id, attachmentIds); }
    catch (error) { if (claimToken !== undefined) this.options.taskTurns?.release(task.id, claimToken); throw error; }
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
      const result = await this.options.agents.turnStart(task.cwd, { sessionId, prompt: agentPrompt ?? prompt, taskId: task.id, sessionName: task.title, ...(model === undefined ? {} : { model }), ...(skills.length === 0 ? {} : { skills }), ...(attachments.length === 0 ? {} : { attachments }) });
      const turnId = readString(readRecord(result)?.['turnId']);
      if (turnId !== undefined) await this.options.tasks.update(task.id, { turnId });
      if (turnId === undefined && claimToken !== undefined) this.options.taskTurns?.release(task.id, claimToken);
      return { accepted: true, ...(turnId === undefined ? {} : { turnId }) };
    } catch (error) {
      if (claimToken !== undefined) this.options.taskTurns?.release(task.id, claimToken);
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
      const queue = task === undefined ? [] : await this.options.tasks.queuedPrompts(taskId);
      if (task === undefined || queue.length === 0 || task.status === 'active' || task.turnId !== undefined) return;
      const next = queue[0]!;
      await this.startPrompt(taskId, next.prompt, next.model, next.attachmentIds, next.skills, next.agentPrompt)
        .then(() => this.options.tasks.dequeuePrompt(taskId, next.id))
        .catch(error => this.options.tasks.appendActivity(taskId, 'error', error instanceof Error ? error.message : 'Queued remote prompt failed.', { remote: true, queued: true }).catch(() => undefined));
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
      const kind = attachmentArtifactKind(upload.mimeType, upload.name);
      const artifact = kind === 'image' ? await this.options.artifacts.createImage(upload.taskId, upload.name, bytes) : kind === 'audio' || kind === 'video' ? await this.options.artifacts.createMedia(upload.taskId, upload.name, bytes, kind) : await this.options.artifacts.createBinary(upload.taskId, upload.name, bytes);
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
    return this.executeCommand(runtime, command).then(result => ({ type: 'command.result', payload: { requestId: messageId, result: sanitizeCommandResult(command, result) } }), error => {
      const message = error instanceof Error ? error.message : 'Remote command failed.';
      this.options.logger.warn('remote-control.command.failed', { action: command.action, requestId: messageId, message });
      return { type: 'command.error', payload: { requestId: messageId, message } };
    });
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

  private sendCurrent(type: string, payload: unknown, delivery: 'reliable' | 'best-effort' = 'reliable'): void { const runtime = this.runtime; if (runtime?.socket !== undefined) this.send(runtime, runtime.socket, type, payload, delivery); }
  private send(runtime: RemoteRuntimeSession, socket: WebSocket, type: string, payload: unknown, delivery: 'reliable' | 'best-effort' = 'reliable'): void {
    if (runtime.cipher === undefined) return;
    const sanitizedPayload = sanitizeOutboundPayload(type, payload);
    const estimatedBytes = estimateRemotePayloadBytes(sanitizedPayload);
    if (runtime.sendQueueEntries >= DESKTOP_RUNTIME_LIMITS.remoteSendQueueEntries || runtime.sendQueueBytes + estimatedBytes > DESKTOP_RUNTIME_LIMITS.remoteSendQueueBytes) {
      if (delivery === 'best-effort') return;
      this.options.logger.error('remote-control.send.queue-overflow', { type, entries: runtime.sendQueueEntries, bytes: runtime.sendQueueBytes });
      socket.terminate();
      return;
    }
    runtime.sendQueueEntries += 1;
    runtime.sendQueueBytes += estimatedBytes;
    const sequence = runtime.nextSequence++;
    runtime.sendChain = runtime.sendChain.catch(() => undefined).then(() => {
      if (this.runtime !== runtime || runtime.stopping || runtime.socket !== socket || socket.readyState !== WebSocket.OPEN || runtime.cipher === undefined) return;
      const envelope = runtime.cipher.encrypt(type, sanitizedPayload, randomUUID(), sequence);
      try { socket.send(JSON.stringify(envelope)); } catch (error) { this.options.logger.warn('remote-control.socket.send.failed', { message: error instanceof Error ? error.message : 'Remote socket send failed.' }); socket.terminate(); }
    }).finally(() => {
      runtime.sendQueueEntries -= 1;
      runtime.sendQueueBytes -= estimatedBytes;
    });
  }

  private isConnected(): boolean { return this.runtime?.socket?.readyState === WebSocket.OPEN && this.runtime.cipher !== undefined; }
  private emit(event?: RemoteControlStateEvent): void { const next = event ?? { type: 'state' as const, session: this.runtime?.publicState ?? null }; for (const listener of this.listeners) listener(next); }
  private emitState(patch: Partial<RemoteControlSession>): void { this.emit({ type: 'state', session: patch.status === 'creating' ? null : this.runtime === undefined ? null : remoteControlSessionSchema.parse({ ...this.runtime.publicState, ...patch }) }); }
  private scheduleExpiry(runtime: RemoteRuntimeSession, expiresAt: string): void {
    const expiryMs = Date.parse(expiresAt);
    const schedule = (): void => {
      if (this.runtime !== runtime || runtime.stopping) return;
      const remainingMs = expiryMs - Date.now();
      const delayMs = Number.isFinite(remainingMs) ? Math.max(0, Math.min(remainingMs, MAX_TIMER_DELAY_MS)) : 0;
      runtime.expiryTimer = setTimeout(() => {
        if (this.runtime !== runtime || runtime.stopping) return;
        if (!Number.isFinite(remainingMs) || remainingMs <= MAX_TIMER_DELAY_MS) { this.expire(); return; }
        schedule();
      }, delayMs);
    };
    schedule();
  }
  private expire(): void { const runtime = this.runtime; if (runtime === undefined) return; runtime.stopping = true; runtime.socket?.close(4002, 'Remote session expired.'); runtime.publicState = remoteControlSessionSchema.parse({ ...runtime.publicState, status: 'expired' }); this.emit(); }
  private clearRuntimeTimers(runtime: RemoteRuntimeSession): void { if (runtime.reconnectTimer !== undefined) clearTimeout(runtime.reconnectTimer); if (runtime.reconnectStableTimer !== undefined) clearTimeout(runtime.reconnectStableTimer); if (runtime.expiryTimer !== undefined) clearTimeout(runtime.expiryTimer); if (runtime.uploadCleanupTimer !== undefined) clearTimeout(runtime.uploadCleanupTimer); runtime.reconnectTimer = undefined; runtime.reconnectStableTimer = undefined; runtime.expiryTimer = undefined; runtime.uploadCleanupTimer = undefined; }
  private clearRuntime(): void { if (this.runtime !== undefined) { this.runtime.stopping = true; this.clearRuntimeTimers(this.runtime); this.runtime.socket?.close(); this.runtime.uploads.clear(); this.runtime.requestLedger.clear(); } this.runtime = undefined; this.drainingTasks.clear(); this.pendingTrustRequests.clear(); }
}

function normalizeServerUrl(value: string): string | undefined { const trimmed = value.trim().replace(/\/$/u, ''); if (!trimmed) return undefined; try { const url = new URL(trimmed); if (!['http:', 'https:'].includes(url.protocol)) return undefined; return url.toString().replace(/\/$/u, ''); } catch { return undefined; } }
function compareTaskSidebarOrder(left: { pinned: boolean; updatedAt: string }, right: { pinned: boolean; updatedAt: string }): number { return Number(right.pinned) - Number(left.pinned) || right.updatedAt.localeCompare(left.updatedAt); }
function attachmentArtifactKind(mimeType: string, name: string): ReturnType<typeof artifactKind> { const normalized = mimeType.toLowerCase(); if (normalized.startsWith('image/')) return 'image'; if (normalized.startsWith('audio/')) return 'audio'; if (normalized.startsWith('video/')) return 'video'; return artifactKind(name); }
function parseServerSession(value: unknown): RemoteServerSessionResponse { if (!isRecord(value) || !isNonEmptyString(value['sessionId']) || !isNonEmptyString(value['hostToken']) || !isNonEmptyString(value['pairingToken']) || !isNonEmptyString(value['expiresAt']) || !isNonEmptyString(value['connectUrl'])) throw new Error('Remote server returned an invalid session.'); return value as unknown as RemoteServerSessionResponse; }
function isAuthAccepted(value: unknown): boolean { return isRecord(value) && value['type'] === 'auth.accepted'; }
function isPeerKeyUpdated(value: unknown): boolean { return isRecord(value) && value['type'] === 'peer.key.updated'; }
function workspaceKey(cwd: string): string { return cwd.replace(/\\/gu, '/').split('/').at(-1) ?? 'workspace'; }
function scheduleQueueDrain(operation: () => Promise<void>): void { const timer = setTimeout(() => { void operation(); }, 100); timer.unref?.(); }
function estimateRemotePayloadBytes(payload: unknown): number { try { return Buffer.byteLength(JSON.stringify(payload), 'utf8') + 512; } catch { return 1_024; } }
function sanitizeValue(value: unknown, depth = 0): unknown { if (typeof value === 'string') return limitText(value); if (value === null || typeof value !== 'object') return value; if (depth > 5) return '[truncated]'; if (Array.isArray(value)) return value.slice(0, 100).map(item => sanitizeValue(item, depth + 1)); if (!isRecord(value)) return value; return Object.fromEntries(Object.entries(value).slice(0, 100).map(([key, item]) => [key, /(?:token|secret|password|authorization|cookie|api[-_]?key|private[-_]?key)/iu.test(key) ? '[redacted]' : sanitizeValue(item, depth + 1)])); }
function sanitizeCommandResult(command: RemoteCommand, result: unknown): unknown {
  if (command.action !== 'artifact.read') return sanitizeValue(result);
  return sanitizeMediaChunkResult(result);
}
function sanitizeOutboundPayload(type: string, payload: unknown): unknown {
  if (type !== 'command.result' || !isRecord(payload) || !isRecord(payload['result'])) return sanitizeValue(payload);
  const bytes = readMediaChunkBytes(payload['result']);
  if (bytes === undefined) return sanitizeValue(payload);
  const sanitized = sanitizeValue({ ...payload, result: { ...payload['result'], bytes: '' } });
  if (!isRecord(sanitized) || !isRecord(sanitized['result'])) return sanitized;
  return { ...sanitized, result: { ...sanitized['result'], bytes } };
}
function sanitizeMediaChunkResult(result: unknown): unknown {
  const bytes = readMediaChunkBytes(result);
  if (bytes === undefined || !isRecord(result)) return sanitizeValue(result);
  const sanitized = sanitizeValue({ ...result, bytes: '' });
  return isRecord(sanitized) ? { ...sanitized, bytes } : sanitized;
}
function readMediaChunkBytes(result: unknown): string | undefined {
  if (!isRecord(result) || typeof result['bytes'] !== 'string') return undefined;
  const bytes = result['bytes'];
  const maxEncodedBytes = Math.ceil(REMOTE_MEDIA_READ_CHUNK_BYTES * 4 / 3) + 4;
  return bytes.length > 0 && bytes.length <= maxEncodedBytes && /^[A-Za-z0-9_-]+$/u.test(bytes) ? bytes : undefined;
}
function limitText(value: string): string { return value.length > 16_384 ? `${value.slice(0, 16_384)}…` : value; }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function isNonEmptyString(value: unknown): value is string { return typeof value === 'string' && value.length > 0; }
function readRecord(value: unknown): Record<string, unknown> | undefined { return isRecord(value) ? value : undefined; }
function readString(value: unknown): string | undefined { return isNonEmptyString(value) ? value : undefined; }
function readModels(value: unknown): Array<{ id: string; label: string; category?: string; contextWindow?: number }> {
  const list = isRecord(value) && Array.isArray(value['models']) ? value['models'] : [];
  return list.flatMap(item => {
    if (typeof item === 'string' && item.length > 0) return [{ id: item, label: item }];
    if (!isRecord(item) || typeof item['id'] !== 'string' || item['id'].length === 0) return [];
    const category = typeof item['model_category'] === 'string' ? item['model_category'] : typeof item['modelCategory'] === 'string' ? item['modelCategory'] : undefined;
    const contextWindow = positiveNumber(item['context_window']) ?? positiveNumber(item['contextWindow']);
    return [{ id: item['id'], label: typeof item['label'] === 'string' && item['label'].length > 0 ? item['label'] : item['id'], ...(category === undefined ? {} : { category }), ...(contextWindow === undefined ? {} : { contextWindow }) }];
  }).slice(0, 100);
}
function readLatestContextUsage(activities: Array<{ kind: string; metadata: Record<string, unknown> }>, models: Array<{ id: string; contextWindow?: number }>, selectedModel?: string): { usedTokens: number; contextWindow: number; model?: string } | undefined {
  for (const activity of [...activities].reverse()) {
    if (activity.kind !== 'usage' || !isRecord(activity.metadata['usage'])) continue;
    const usage = activity.metadata['usage'];
    const usedTokens = nonNegativeNumber(usage['promptTokens']) ?? nonNegativeNumber(usage['totalTokens']);
    const model = typeof activity.metadata['model'] === 'string' ? activity.metadata['model'] : selectedModel;
    const contextWindow = positiveNumber(activity.metadata['contextWindow']) ?? models.find(item => item.id === model)?.contextWindow;
    if (usedTokens !== undefined && contextWindow !== undefined) return { usedTokens, contextWindow, ...(model === undefined ? {} : { model }) };
  }
  return undefined;
}

function defaultContextUsage(models: Array<{ id: string; contextWindow?: number }>, selectedModel?: string): { usedTokens: number; contextWindow: number; model?: string } | undefined {
  const contextWindow = models.find(item => item.id === selectedModel)?.contextWindow;
  return contextWindow === undefined ? undefined : { usedTokens: 0, contextWindow, ...(selectedModel === undefined ? {} : { model: selectedModel }) };
}
function positiveNumber(value: unknown): number | undefined { const number = nonNegativeNumber(value); return number !== undefined && number > 0 ? number : undefined; }
function nonNegativeNumber(value: unknown): number | undefined { return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : typeof value === 'string' && Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : undefined; }
function readCommands(value: unknown): RemoteCommandDescriptor[] {
  const list = isRecord(value) && Array.isArray(value['commands']) ? value['commands'] : [];
  return list.flatMap(item => {
    if (!isRecord(item) || typeof item['id'] !== 'string' || !Array.isArray(item['path']) || item['path'].some(part => typeof part !== 'string') || typeof item['summary'] !== 'string') return [];
    const argumentsValue = readCommandArguments(item['arguments']);
    const optionsValue = readCommandOptions(item['options']);
    return [{ id: item['id'], path: item['path'] as string[], summary: item['summary'], ...(argumentsValue === undefined ? {} : { arguments: argumentsValue }), ...(optionsValue === undefined ? {} : { options: optionsValue }) }];
  }).slice(0, 100);
}
function mergeRemoteCommandDescriptors(commands: ReturnType<typeof readCommands>) {
  const byId = new Map(commands.map(command => [command.id, command]));
  return REMOTE_SLASH_COMMAND_DEFINITIONS.flatMap(definition => {
    const command = byId.get(definition.id);
    return command === undefined ? [] : [{ ...command, slash: definition }];
  });
}
function readSkills(value: unknown): Array<{ name: string; detail: string }> {
  const structured = isRecord(value) && isRecord(value['structured']) ? value['structured'] : undefined;
  const items = structured !== undefined && structured['kind'] === 'skill' && Array.isArray(structured['items']) ? structured['items'] : [];
  return items.flatMap(item => {
    if (!isRecord(item) || typeof item['name'] !== 'string' || item['name'].length === 0 || item['status'] !== 'ENABLED' || typeof item['detail'] !== 'string') return [];
    return [{ name: item['name'], detail: item['detail'] }];
  }).slice(0, 100);
}
function readCommandArguments(value: unknown): Array<{ name: string; required: boolean; variadic?: boolean }> | undefined {
  if (!Array.isArray(value)) return undefined;
  const result = value.flatMap(item => isRecord(item) && typeof item['name'] === 'string' && typeof item['required'] === 'boolean' ? [{ name: item['name'], required: item['required'], ...(typeof item['variadic'] === 'boolean' ? { variadic: item['variadic'] } : {}) }] : []);
  return result.length === value.length ? result : undefined;
}
function readCommandOptions(value: unknown): Array<{ name: string; valueName?: string; description: string; required?: boolean; allowedValues?: string[] }> | undefined {
  if (!Array.isArray(value)) return undefined;
  const result = value.flatMap(item => {
    if (!isRecord(item) || typeof item['name'] !== 'string' || typeof item['description'] !== 'string') return [];
    const allowedValues = Array.isArray(item['allowedValues']) && item['allowedValues'].every(option => typeof option === 'string') ? item['allowedValues'] as string[] : undefined;
    return [{ name: item['name'], description: item['description'], ...(typeof item['valueName'] === 'string' ? { valueName: item['valueName'] } : {}), ...(typeof item['required'] === 'boolean' ? { required: item['required'] } : {}), ...(allowedValues === undefined ? {} : { allowedValues }) }];
  });
  return result.length === value.length ? result : undefined;
}
function readStringArray(value: unknown): string[] { return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.length > 0) : []; }
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
