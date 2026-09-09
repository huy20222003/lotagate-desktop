import { randomUUID } from 'node:crypto';
import { CliAgentProcess, type CliAgentDiagnostic, type CliAgentEventHandler } from './cli-agent-process.js';
import { resolveCliInvocation } from './cli-resolver.js';
import type { DesktopAgentResult, DesktopEvent, DesktopExecutionPolicy, DesktopHostRequest, DesktopHostResponse, DesktopReasoningEffort, DesktopSkillSelection } from '../../contracts/agent-protocol/v1/desktop.js';
import { requireDirectory } from '../security/path-policy.js';
import { CACHE_TTL_MS } from '../cache/cache-policy.js';
import type { PersistentCache } from '../cache/persistent-cache.js';
import { buildInteractiveDesktopExecutionPolicy } from './desktop-execution-policy.js';
import type { ExtensionProtocol, PluginIconInput } from '../extensions/extension-protocol.js';
import type { ExtensionDetailInput, PublicPluginContributionInput } from '../../contracts/ipc/v1/extensions.js';
import { DESKTOP_RUNTIME_LIMITS } from '../../contracts/runtime-limits.js';

export interface AgentManagerHandler {
  onEvent(projectRoot: string, event: DesktopEvent): void;
  onHostRequest?(projectRoot: string, request: DesktopHostRequest, signal?: AbortSignal): Promise<DesktopHostResponse>;
  onDiagnostic?(projectRoot: string, diagnostic: CliAgentDiagnostic): void;
  onExit?(projectRoot: string, error: Error, sessionId?: string, approvalIds?: readonly string[]): void;
}

export interface CliAttachmentInput { id: string; name: string; mimeType: string; sizeBytes: number; path: string; }

interface ProcessBinding { key: string; projectRoot: string; sessionId?: string; process: CliAgentProcess; }
interface CommandEventBuffer { events: DesktopEvent[]; bytes: number; truncated: boolean; resolve: (events: DesktopEvent[]) => void; operation: Promise<DesktopEvent[]>; timer: ReturnType<typeof setTimeout> }

interface CommandExecutionResult { content: string; structured?: Record<string, unknown>; truncated: boolean; }

export interface AgentManagerOptions { idleTimeoutMs?: number; computerHost?: boolean; documentHost?: boolean; }

/** Owns one CLI process per Desktop session; project-level calls use a separate control process. */
export class AgentManager {
  private readonly processes = new Map<string, ProcessBinding>();
  private readonly sessionBindings = new Map<string, ProcessBinding>();
  private readonly sessionResumes = new Map<string, Promise<unknown>>();
  private readonly turnBindings = new Map<string, ProcessBinding>();
  private readonly approvalBindings = new Map<string, ProcessBinding>();
  private readonly trustBindings = new Map<string, ProcessBinding>();
  private readonly recoveryAttempts = new Map<string, number>();
  private readonly recoveryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly idleTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly commandEventBuffers = new Map<string, CommandEventBuffer>();
  private readonly protocolCacheLoads = new Map<string, Promise<unknown>>();
  private readonly idleTimeoutMs: number;

  constructor(private readonly handler: AgentManagerHandler, private readonly cache?: PersistentCache, private readonly getInteractiveExecutionPolicy: () => Promise<DesktopExecutionPolicy> = async () => buildInteractiveDesktopExecutionPolicy(), private readonly options: AgentManagerOptions = {}) {
    this.idleTimeoutMs = Number.isFinite(this.options.idleTimeoutMs) ? Math.max(1_000, Math.floor(this.options.idleTimeoutMs!)) : DESKTOP_RUNTIME_LIMITS.agentIdleTimeoutMs;
  }

  async initialize(cwd: string): Promise<DesktopAgentResult> { return (await this.initializedProcess(await requireDirectory(cwd), undefined)).initialize(); }

  async sessionCreate(cwd: string, input: { model?: string; name?: string }): Promise<unknown> {
    const projectRoot = await requireDirectory(cwd);
    const binding = this.createProcess(projectRoot, `session:${randomUUID()}`);
    await binding.process.initialize();
    try {
      const result = await binding.process.request('session.create', input);
      const sessionId = extractSessionId(result);
      if (sessionId === undefined) throw new Error('The CLI did not return a session id.');
      binding.sessionId = sessionId; this.sessionBindings.set(sessionId, binding); this.touch(binding);
      return result;
    } catch (error) { this.removeBinding(binding); await binding.process.shutdown('session-create-failed'); throw error; }
  }

  async sessionList(cwd: string): Promise<unknown> { return this.request(cwd, 'session.list', {}); }

  async generateTitle(cwd: string, input: { prompt: string; model?: string }): Promise<unknown> { return this.request(cwd, 'title.generate', input); }

  async sessionResume(cwd: string, sessionId: string): Promise<unknown> {
    const projectRoot = await requireDirectory(cwd);
    const existing = this.sessionBindings.get(sessionId);
    if (existing !== undefined) { if (existing.projectRoot !== projectRoot) throw new Error('The session belongs to a different project.'); this.touch(existing); return existing.process.request('session.resume', { sessionId }); }
    const resumeKey = `${projectRoot}\u0000${sessionId}`;
    const pending = this.sessionResumes.get(resumeKey);
    if (pending !== undefined) return pending;
    const operation = this.openSession(projectRoot, sessionId);
    this.sessionResumes.set(resumeKey, operation);
    try { return await operation; } finally { if (this.sessionResumes.get(resumeKey) === operation) this.sessionResumes.delete(resumeKey); }
  }

  private async openSession(projectRoot: string, sessionId: string): Promise<unknown> {
    const binding = this.createProcess(projectRoot, `session:${sessionId}`);
    await binding.process.initialize();
    try { const result = await binding.process.request('session.resume', { sessionId }); binding.sessionId = sessionId; this.sessionBindings.set(sessionId, binding); this.touch(binding); return result; }
    catch (error) { this.removeBinding(binding); await binding.process.shutdown('session-resume-failed'); throw error; }
  }

  async turnStart(cwd: string, input: { sessionId: string; prompt: string; model?: string; reasoningEffort?: DesktopReasoningEffort; runId?: string; taskId?: string; sessionName?: string; execution?: DesktopExecutionPolicy; skills?: DesktopSkillSelection; attachments?: CliAttachmentInput[] }): Promise<unknown> {
    const projectRoot = await requireDirectory(cwd);
    const binding = await this.sessionProcess(projectRoot, input.sessionId);
    const attachmentIds: string[] = [];
    for (const attachment of input.attachments ?? []) { await binding.process.uploadAttachment(attachment); attachmentIds.push(attachment.id); }
    this.touch(binding);
    const result = await binding.process.request('turn.start', { sessionId: input.sessionId, prompt: input.prompt, ...(input.model === undefined ? {} : { model: input.model }), ...(input.reasoningEffort === undefined ? {} : { reasoningEffort: input.reasoningEffort }), ...(input.runId === undefined ? {} : { runId: input.runId }), ...(input.taskId === undefined ? {} : { taskId: input.taskId }), ...(input.sessionName === undefined ? {} : { sessionName: input.sessionName }), ...(input.skills === undefined ? {} : { skills: [...input.skills] }), execution: input.execution ?? await this.getInteractiveExecutionPolicy(), ...(attachmentIds.length === 0 ? {} : { attachmentIds }) });
    const turnId = extractTurnId(result); if (turnId !== undefined) this.turnBindings.set(turnId, binding); return result;
  }

  async turnCancel(cwd: string, turnId: string): Promise<unknown> { return this.requestOnBinding(await this.bindingForTurn(cwd, turnId), 'turn.cancel', { turnId }); }
  async approvalRespond(cwd: string, input: { approvalId: string; approved: boolean }): Promise<unknown> {
    const binding = await this.bindingForApproval(cwd, input.approvalId);
    try { return await this.requestOnBinding(binding, 'approval.respond', input); }
    finally { if (this.approvalBindings.get(input.approvalId) === binding) this.approvalBindings.delete(input.approvalId); }
  }
  async trustRespond(cwd: string, input: { trustRequestId: string; trusted: boolean }): Promise<unknown> {
    const binding = await this.bindingForTrust(cwd, input.trustRequestId);
    try { return await this.requestOnBinding(binding, 'trust.respond', input); }
    finally { if (this.trustBindings.get(input.trustRequestId) === binding) this.trustBindings.delete(input.trustRequestId); }
  }
  async modelList(cwd: string): Promise<unknown> { return this.cachedProtocolResult(cwd, 'models', CACHE_TTL_MS.models, () => this.request(cwd, 'model.list', {})); }
  async commandList(cwd: string): Promise<unknown> { return this.cachedProtocolResult(cwd, 'commands', CACHE_TTL_MS.models, () => this.request(cwd, 'command.list', {})); }
  async commandExecute(cwd: string, input: Record<string, unknown>): Promise<unknown> { return this.request(cwd, 'command.execute', input); }
  async commandExecuteResult(cwd: string, input: Record<string, unknown>): Promise<CommandExecutionResult> {
    const accepted = await this.commandExecute(cwd, input);
    const commandId = isRecord(accepted) && typeof accepted['commandId'] === 'string' ? accepted['commandId'] : undefined;
    if (commandId === undefined) throw new Error('The CLI did not return a command id.');
    const buffer = this.commandEventBuffers.get(commandId) ?? this.createCommandEventBuffer(commandId);
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const events = await Promise.race([buffer.operation, new Promise<DesktopEvent[]>((_, reject) => { timeout = setTimeout(() => reject(new CommandExecutionTimeoutError()), DESKTOP_RUNTIME_LIMITS.commandEventBufferTtlMs); })]);
      return this.readCommandExecutionResult(commandId, buffer, events);
    } catch (error) {
      if (!(error instanceof CommandExecutionTimeoutError)) throw error;
      this.extendCommandEventBuffer(commandId, buffer, DESKTOP_RUNTIME_LIMITS.commandCancellationGraceMs);
      await this.cancelTimedOutCommand(cwd, commandId, buffer);
      throw error;
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
    }
  }
  private readCommandExecutionResult(commandId: string, buffer: CommandEventBuffer, events: DesktopEvent[]): CommandExecutionResult {
    let content = '';
    let structured: Record<string, unknown> | undefined;
    let exitCode: number | undefined;
    try {
      for (const event of events) {
        if (event.event === 'command.output') {
          if (typeof event.data['content'] === 'string') content += event.data['content'];
          if (isRecord(event.data['structured'])) structured = event.data['structured'];
        }
        if (event.event === 'command.completed' && typeof event.data['exitCode'] === 'number') exitCode = event.data['exitCode'];
        if (event.event === 'command.failed') throw new Error((readCommandError(event.data['error']) ?? content.trim()) || 'Command failed.');
        if (event.event === 'command.cancelled') throw new Error('Command was cancelled.');
      }
      if (exitCode !== undefined && exitCode !== 0) throw new Error(content.trim() || `Command exited with code ${exitCode}.`);
      return { content, ...(structured === undefined ? {} : { structured }), truncated: buffer.truncated };
    } finally {
      this.disposeCommandEventBuffer(commandId, buffer);
    }
  }
  async commandCancel(cwd: string, commandId: string): Promise<unknown> { return this.request(cwd, 'command.cancel', { commandId }); }

  async extensionListPublicPlugins(root: string): Promise<Awaited<ReturnType<ExtensionProtocol['listPublicPlugins']>>> {
    return this.request(root, 'extension.listPublicPlugins', { root }) as Promise<Awaited<ReturnType<ExtensionProtocol['listPublicPlugins']>>>;
  }
  async extensionResolvePublicPluginSource(root: string, name: string): Promise<string> {
    const result = await this.request(root, 'extension.resolvePublicPluginSource', { root, name });
    if (!isRecord(result) || typeof result['path'] !== 'string') throw new Error('The CLI did not return a public plugin source path.');
    return result['path'];
  }
  async extensionReadPublicPluginContribution(root: string, input: PublicPluginContributionInput): Promise<Awaited<ReturnType<ExtensionProtocol['readPublicPluginContribution']>>> {
    return this.request(root, 'extension.readPublicPluginContribution', { root, ...input }) as Promise<Awaited<ReturnType<ExtensionProtocol['readPublicPluginContribution']>>>;
  }
  async extensionReadDetail(cwd: string, input: Omit<ExtensionDetailInput, 'cwd'>): Promise<Awaited<ReturnType<ExtensionProtocol['readDetail']>>> {
    return this.request(cwd, 'extension.readDetail', input) as Promise<Awaited<ReturnType<ExtensionProtocol['readDetail']>>>;
  }
  async extensionReadPluginIcon(cwd: string, input: PluginIconInput): Promise<Awaited<ReturnType<ExtensionProtocol['readPluginIcon']>>> {
    return this.request(cwd, 'extension.readPluginIcon', { ...input }) as Promise<Awaited<ReturnType<ExtensionProtocol['readPluginIcon']>>>;
  }

  isApprovalProcessAvailable(cwd: string, approvalId: string): boolean {
    const binding = this.approvalBindings.get(approvalId);
    return binding !== undefined && binding.projectRoot === cwd && binding.process.isAvailable();
  }

  async shutdown(cwd: string, reason = 'ipc.agent.shutdown'): Promise<void> { const projectRoot = await requireDirectory(cwd); await Promise.allSettled([...this.processes.values()].filter(binding => binding.projectRoot === projectRoot).map(binding => this.shutdownBinding(binding, reason))); }
  async shutdownAll(reason = 'shutdown-all'): Promise<void> { await Promise.allSettled([...this.processes.values()].map(binding => this.shutdownBinding(binding, reason))); this.processes.clear(); this.sessionBindings.clear(); this.sessionResumes.clear(); this.turnBindings.clear(); this.approvalBindings.clear(); this.trustBindings.clear(); this.protocolCacheLoads.clear(); for (const timer of this.recoveryTimers.values()) clearTimeout(timer); this.recoveryTimers.clear(); this.recoveryAttempts.clear(); for (const timer of this.idleTimers.values()) clearTimeout(timer); this.idleTimers.clear(); for (const buffer of this.commandEventBuffers.values()) clearTimeout(buffer.timer); this.commandEventBuffers.clear(); }

  private createProcess(projectRoot: string, key: string): ProcessBinding {
    const current = this.processes.get(key); if (current !== undefined) return current;
    let binding!: ProcessBinding;
    const eventHandler: CliAgentEventHandler = {
      onEvent: event => {
        if (event.event === 'approval.requested' && typeof event.data['approvalId'] === 'string') { this.approvalBindings.set(event.data['approvalId'], binding); this.touch(binding); }
        if (event.event === 'trust.requested' && typeof event.data['trustRequestId'] === 'string') { this.trustBindings.set(event.data['trustRequestId'], binding); this.touch(binding); }
        if (event.event === 'turn.started' && typeof event.data['turnId'] === 'string') this.turnBindings.set(event.data['turnId'], binding);
        if (event.event === 'turn.completed' || event.event === 'turn.failed' || event.event === 'turn.cancelled') { const turnId = typeof event.data['turnId'] === 'string' ? event.data['turnId'] : undefined; if (turnId !== undefined) this.turnBindings.delete(turnId); this.touch(binding); }
        this.recordCommandEvent(event);
        this.handler.onEvent(projectRoot, event);
      },
      onHostRequest: (request, signal) => this.handler.onHostRequest === undefined ? Promise.resolve({ version: 1, type: 'host.response', requestId: request.requestId, tool: request.tool, ok: false, error: { code: 'HOST_UNAVAILABLE', category: 'execution', message: 'The Desktop host is unavailable.', retryable: false } }) : this.handler.onHostRequest(projectRoot, request, signal),
      onDiagnostic: diagnostic => this.handler.onDiagnostic?.(projectRoot, { ...diagnostic, ...(diagnostic.sessionId === undefined && binding.sessionId === undefined ? {} : { sessionId: diagnostic.sessionId ?? binding.sessionId }) }),
      onExit: error => {
        const approvalIds = [...this.approvalBindings.entries()].filter(([, candidate]) => candidate === binding).map(([approvalId]) => approvalId);
        this.clearBindingRoutes(binding);
        this.handler.onExit?.(projectRoot, error, binding.sessionId, approvalIds);
        this.scheduleRecovery(binding);
      },
    };
    binding = { key, projectRoot, process: new CliAgentProcess({ cwd: projectRoot, ...resolveCliInvocation(), computerHost: this.options.computerHost === true, documentHost: this.options.documentHost === true }, eventHandler) }; this.processes.set(key, binding); this.touch(binding); return binding;
  }

  private async sessionProcess(projectRoot: string, sessionId: string): Promise<ProcessBinding> {
    const existing = this.sessionBindings.get(sessionId);
    if (existing !== undefined) { if (existing.projectRoot !== projectRoot) throw new Error('The session belongs to a different project.'); this.touch(existing); await existing.process.initialize(); return existing; }
    await this.sessionResume(projectRoot, sessionId); const resumed = this.sessionBindings.get(sessionId); if (resumed === undefined) throw new Error('The CLI session process was not created.'); return resumed;
  }
  private async initializedProcess(projectRoot: string, sessionId: string | undefined): Promise<CliAgentProcess> { const binding = sessionId === undefined ? this.createProcess(projectRoot, `control:${projectRoot}`) : await this.sessionProcess(projectRoot, sessionId); this.touch(binding); await binding.process.initialize(); return binding.process; }
  private async request(cwd: string, method: string, input: Record<string, unknown>): Promise<unknown> { return (await this.initializedProcess(await requireDirectory(cwd), undefined)).request(method, input); }
  private async requestOnBinding(binding: ProcessBinding, method: string, input: Record<string, unknown>): Promise<unknown> { this.touch(binding); await binding.process.initialize(); return binding.process.request(method, input); }
  private async bindingForTurn(cwd: string, turnId: string): Promise<ProcessBinding> { return this.bindingForId(await requireDirectory(cwd), this.turnBindings.get(turnId), 'turn'); }
  private async bindingForApproval(cwd: string, approvalId: string): Promise<ProcessBinding> { return this.bindingForId(await requireDirectory(cwd), this.approvalBindings.get(approvalId), 'approval'); }
  private async bindingForTrust(cwd: string, trustRequestId: string): Promise<ProcessBinding> { return this.bindingForId(await requireDirectory(cwd), this.trustBindings.get(trustRequestId), 'trust'); }
  private async bindingForId(projectRoot: string, binding: ProcessBinding | undefined, kind: string): Promise<ProcessBinding> { if (binding === undefined || binding.projectRoot !== projectRoot) throw new Error(`The requested ${kind} does not belong to this project.`); return binding; }
  private scheduleRecovery(binding: ProcessBinding): void { const attempt = this.recoveryAttempts.get(binding.key) ?? 0; if (attempt >= 3 || this.recoveryTimers.has(binding.key)) { if (attempt >= 3) { this.removeBinding(binding); void binding.process.shutdown('recovery-exhausted').catch(error => this.handler.onDiagnostic?.(binding.projectRoot, { kind: 'protocol', severity: 'error', message: error instanceof Error ? error.message : 'CLI recovery cleanup failed.' })); } return; } const delayMs = 1_000 * 2 ** attempt; this.recoveryAttempts.set(binding.key, attempt + 1); this.handler.onDiagnostic?.(binding.projectRoot, { kind: 'protocol', message: `CLI recovery scheduled in ${delayMs}ms (attempt ${attempt + 1}/3).` }); const timer = setTimeout(() => { this.recoveryTimers.delete(binding.key); void binding.process.initialize().then(() => { this.recoveryAttempts.delete(binding.key); }).catch(error => { this.handler.onDiagnostic?.(binding.projectRoot, { kind: 'protocol', severity: 'error', message: error instanceof Error ? error.message : 'CLI recovery failed.' }); this.scheduleRecovery(binding); }); }, delayMs); this.recoveryTimers.set(binding.key, timer); }
  private removeBinding(binding: ProcessBinding): void { this.processes.delete(binding.key); if (binding.sessionId !== undefined) this.sessionBindings.delete(binding.sessionId); this.clearBindingRoutes(binding); this.clearIdle(binding.key); }
  private clearBindingRoutes(binding: ProcessBinding): void { for (const [id, candidate] of this.turnBindings) if (candidate === binding) this.turnBindings.delete(id); for (const [id, candidate] of this.approvalBindings) if (candidate === binding) this.approvalBindings.delete(id); for (const [id, candidate] of this.trustBindings) if (candidate === binding) this.trustBindings.delete(id); }
  private async shutdownBinding(binding: ProcessBinding, reason: string): Promise<void> { this.removeBinding(binding); this.clearRecovery(binding.key); await binding.process.shutdown(reason); }
  private clearRecovery(key: string): void { const timer = this.recoveryTimers.get(key); if (timer !== undefined) clearTimeout(timer); this.recoveryTimers.delete(key); this.recoveryAttempts.delete(key); }
  private touch(binding: ProcessBinding): void { this.clearIdle(binding.key); const timer = setTimeout(() => { this.idleTimers.delete(binding.key); void this.expireIdle(binding); }, this.idleTimeoutMs); timer.unref?.(); this.idleTimers.set(binding.key, timer); }
  private async expireIdle(binding: ProcessBinding): Promise<void> {
    if (this.processes.get(binding.key) !== binding || this.recoveryTimers.has(binding.key)) return;
    if ([...this.turnBindings.values(), ...this.approvalBindings.values(), ...this.trustBindings.values()].includes(binding)) { this.touch(binding); return; }
    await this.shutdownBinding(binding, 'idle-timeout').catch(error => this.handler.onDiagnostic?.(binding.projectRoot, { kind: 'protocol', severity: 'error', message: error instanceof Error ? error.message : 'Idle CLI process shutdown failed.' }));
  }
  private clearIdle(key: string): void { const timer = this.idleTimers.get(key); if (timer !== undefined) clearTimeout(timer); this.idleTimers.delete(key); }
  private recordCommandEvent(event: DesktopEvent): void {
    if (!event.event.startsWith('command.')) return;
    const commandId = typeof event.data['commandId'] === 'string' ? event.data['commandId'] : undefined;
    if (commandId === undefined) return;
    const buffer = this.commandEventBuffers.get(commandId) ?? this.createCommandEventBuffer(commandId);
    const eventBytes = Buffer.byteLength(JSON.stringify(event));
    if (buffer.bytes + eventBytes <= DESKTOP_RUNTIME_LIMITS.commandEventBufferBytes || event.event === 'command.completed' || event.event === 'command.failed' || event.event === 'command.cancelled') {
      buffer.events.push(event);
      buffer.bytes += eventBytes;
    } else buffer.truncated = true;
    if (event.event === 'command.completed' || event.event === 'command.failed' || event.event === 'command.cancelled') buffer.resolve(buffer.events);
  }
  private createCommandEventBuffer(commandId: string): CommandEventBuffer {
    let resolve!: (events: DesktopEvent[]) => void;
    const operation = new Promise<DesktopEvent[]>(nextResolve => { resolve = nextResolve; });
    const timer = setTimeout(() => this.disposeCommandEventBuffer(commandId, this.commandEventBuffers.get(commandId)), DESKTOP_RUNTIME_LIMITS.commandEventBufferTtlMs);
    timer.unref?.();
    const buffer: CommandEventBuffer = { events: [], bytes: 0, truncated: false, resolve, operation, timer };
    this.commandEventBuffers.set(commandId, buffer);
    return buffer;
  }
  private extendCommandEventBuffer(commandId: string, buffer: CommandEventBuffer, durationMs: number): void { if (this.commandEventBuffers.get(commandId) !== buffer) return; clearTimeout(buffer.timer); buffer.timer = setTimeout(() => this.disposeCommandEventBuffer(commandId, buffer), durationMs); buffer.timer.unref?.(); }
  private async cancelTimedOutCommand(cwd: string, commandId: string, buffer: CommandEventBuffer): Promise<void> { try { await Promise.race([this.commandCancel(cwd, commandId), delay(DESKTOP_RUNTIME_LIMITS.commandCancellationGraceMs)]); await Promise.race([buffer.operation, delay(DESKTOP_RUNTIME_LIMITS.commandCancellationGraceMs)]); } catch (error) { this.handler.onDiagnostic?.(cwd, { kind: 'protocol', severity: 'error', message: error instanceof Error ? `Timed-out CLI command cancellation failed: ${error.message}` : 'Timed-out CLI command cancellation failed.' }); } }
  private disposeCommandEventBuffer(commandId: string, buffer: CommandEventBuffer | undefined): void {
    if (buffer === undefined || this.commandEventBuffers.get(commandId) !== buffer) return;
    clearTimeout(buffer.timer);
    this.commandEventBuffers.delete(commandId);
  }
  private async cachedProtocolResult(cwd: string, kind: string, ttlMs: number, load: () => Promise<unknown>): Promise<unknown> {
    const canonical = await requireDirectory(cwd);
    const key = `agent:${kind}:${canonical}`;
    const cached = await this.cache?.get<unknown>(key);
    if (cached !== undefined) return cached;
    const pending = this.protocolCacheLoads.get(key);
    if (pending !== undefined) return pending;
    const operation = load().then(async value => {
      await this.cache?.set(key, value, ttlMs);
      return value;
    });
    this.protocolCacheLoads.set(key, operation);
    try { return await operation; }
    finally { if (this.protocolCacheLoads.get(key) === operation) this.protocolCacheLoads.delete(key); }
  }
}

function extractSessionId(value: unknown): string | undefined { if (!isRecord(value) || !isRecord(value['session'])) return undefined; return typeof value['session']['id'] === 'string' ? value['session']['id'] : undefined; }
function extractTurnId(value: unknown): string | undefined { return isRecord(value) && typeof value['turnId'] === 'string' ? value['turnId'] : undefined; }
function readCommandError(value: unknown): string | undefined { return isRecord(value) && typeof value['message'] === 'string' ? value['message'] : undefined; }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }

class CommandExecutionTimeoutError extends Error {
  constructor() { super('The CLI command did not complete before the timeout and cancellation was requested.'); }
}

function delay(milliseconds: number): Promise<void> { return new Promise(resolve => { setTimeout(resolve, milliseconds); }); }
