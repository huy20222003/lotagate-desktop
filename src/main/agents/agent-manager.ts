import { randomUUID } from 'node:crypto';
import { CliAgentProcess, type CliAgentEventHandler } from './cli-agent-process.js';
import { resolveCliInvocation } from './cli-resolver.js';
import type { DesktopAgentResult, DesktopEvent, DesktopExecutionPolicy, DesktopHostRequest, DesktopHostResponse, DesktopSkillSelection } from '../../contracts/agent-protocol/v1/desktop.js';
import { requireDirectory } from '../security/path-policy.js';
import { CACHE_TTL_MS } from '../cache/cache-policy.js';
import type { PersistentCache } from '../cache/persistent-cache.js';
import { buildInteractiveDesktopExecutionPolicy } from './desktop-execution-policy.js';

export interface AgentManagerHandler {
  onEvent(projectRoot: string, event: DesktopEvent): void;
  onHostRequest?(projectRoot: string, request: DesktopHostRequest): Promise<DesktopHostResponse>;
  onDiagnostic?(projectRoot: string, diagnostic: { kind: 'stderr' | 'protocol'; message: string }): void;
  onExit?(projectRoot: string, error: Error, sessionId?: string, approvalIds?: readonly string[]): void;
}

export interface CliAttachmentInput { id: string; name: string; mimeType: string; sizeBytes: number; path: string; }

interface ProcessBinding { key: string; projectRoot: string; sessionId?: string; process: CliAgentProcess; }

export interface AgentManagerOptions { idleTimeoutMs?: number; now?: () => number; }
const DEFAULT_AGENT_IDLE_TIMEOUT_MS = 30 * 60 * 1_000;

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
  private readonly idleTimeoutMs: number;
  private readonly now: () => number;

  constructor(private readonly handler: AgentManagerHandler, private readonly cache?: PersistentCache, private readonly getInteractiveExecutionPolicy: () => Promise<DesktopExecutionPolicy> = async () => buildInteractiveDesktopExecutionPolicy(), options: AgentManagerOptions = {}) {
    this.idleTimeoutMs = Number.isFinite(options.idleTimeoutMs) ? Math.max(1_000, Math.floor(options.idleTimeoutMs!)) : DEFAULT_AGENT_IDLE_TIMEOUT_MS;
    this.now = options.now ?? Date.now;
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

  async sessionResume(cwd: string, sessionId: string): Promise<unknown> {
    const projectRoot = await requireDirectory(cwd);
    const existing = this.sessionBindings.get(sessionId);
    if (existing !== undefined) { if (existing.projectRoot !== projectRoot) throw new Error('The session belongs to a different project.'); this.touch(existing); return existing.process.request('session.resume', { sessionId }); }
    const pending = this.sessionResumes.get(sessionId);
    if (pending !== undefined) return pending;
    const operation = this.openSession(projectRoot, sessionId);
    this.sessionResumes.set(sessionId, operation);
    try { return await operation; } finally { if (this.sessionResumes.get(sessionId) === operation) this.sessionResumes.delete(sessionId); }
  }

  private async openSession(projectRoot: string, sessionId: string): Promise<unknown> {
    const binding = this.createProcess(projectRoot, `session:${sessionId}`);
    await binding.process.initialize();
    try { const result = await binding.process.request('session.resume', { sessionId }); binding.sessionId = sessionId; this.sessionBindings.set(sessionId, binding); this.touch(binding); return result; }
    catch (error) { this.removeBinding(binding); await binding.process.shutdown('session-resume-failed'); throw error; }
  }

  async turnStart(cwd: string, input: { sessionId: string; prompt: string; model?: string; runId?: string; taskId?: string; execution?: DesktopExecutionPolicy; skills?: DesktopSkillSelection; attachments?: CliAttachmentInput[] }): Promise<unknown> {
    const projectRoot = await requireDirectory(cwd);
    const binding = await this.sessionProcess(projectRoot, input.sessionId);
    const attachmentIds: string[] = [];
    for (const attachment of input.attachments ?? []) { await binding.process.uploadAttachment(attachment); attachmentIds.push(attachment.id); }
    this.touch(binding);
    const result = await binding.process.request('turn.start', { sessionId: input.sessionId, prompt: input.prompt, ...(input.model === undefined ? {} : { model: input.model }), ...(input.runId === undefined ? {} : { runId: input.runId }), ...(input.taskId === undefined ? {} : { taskId: input.taskId }), ...(input.skills === undefined ? {} : { skills: [...input.skills] }), execution: input.execution ?? await this.getInteractiveExecutionPolicy(), ...(attachmentIds.length === 0 ? {} : { attachmentIds }) });
    const turnId = extractTurnId(result); if (turnId !== undefined) this.turnBindings.set(turnId, binding); return result;
  }

  async turnCancel(cwd: string, turnId: string): Promise<unknown> { return this.requestOnBinding(await this.bindingForTurn(cwd, turnId), 'turn.cancel', { turnId }); }
  async approvalRespond(cwd: string, input: { approvalId: string; approved: boolean }): Promise<unknown> { return this.requestOnBinding(await this.bindingForApproval(cwd, input.approvalId), 'approval.respond', input); }
  async trustRespond(cwd: string, input: { trustRequestId: string; trusted: boolean }): Promise<unknown> { return this.requestOnBinding(await this.bindingForTrust(cwd, input.trustRequestId), 'trust.respond', input); }
  async modelList(cwd: string): Promise<unknown> { return this.cachedProtocolResult(cwd, 'models', CACHE_TTL_MS.models, () => this.request(cwd, 'model.list', {})); }
  async commandList(cwd: string): Promise<unknown> { return this.cachedProtocolResult(cwd, 'commands', CACHE_TTL_MS.models, () => this.request(cwd, 'command.list', {})); }
  async commandExecute(cwd: string, input: Record<string, unknown>): Promise<unknown> { return this.request(cwd, 'command.execute', input); }
  async commandCancel(cwd: string, commandId: string): Promise<unknown> { return this.request(cwd, 'command.cancel', { commandId }); }

  isApprovalProcessAvailable(cwd: string, approvalId: string): boolean {
    const binding = this.approvalBindings.get(approvalId);
    return binding !== undefined && binding.projectRoot === cwd && binding.process.isAvailable();
  }

  async shutdown(cwd: string, reason = 'ipc.agent.shutdown'): Promise<void> { const projectRoot = await requireDirectory(cwd); await Promise.allSettled([...this.processes.values()].filter(binding => binding.projectRoot === projectRoot).map(binding => this.shutdownBinding(binding, reason))); }
  async shutdownAll(reason = 'shutdown-all'): Promise<void> { await Promise.allSettled([...this.processes.values()].map(binding => this.shutdownBinding(binding, reason))); this.processes.clear(); this.sessionBindings.clear(); this.sessionResumes.clear(); this.turnBindings.clear(); this.approvalBindings.clear(); this.trustBindings.clear(); for (const timer of this.recoveryTimers.values()) clearTimeout(timer); this.recoveryTimers.clear(); this.recoveryAttempts.clear(); for (const timer of this.idleTimers.values()) clearTimeout(timer); this.idleTimers.clear(); }

  private createProcess(projectRoot: string, key: string): ProcessBinding {
    const current = this.processes.get(key); if (current !== undefined) return current;
    let binding!: ProcessBinding;
    const eventHandler: CliAgentEventHandler = {
      onEvent: event => {
        if (event.event === 'approval.requested' && typeof event.data['approvalId'] === 'string') { this.approvalBindings.set(event.data['approvalId'], binding); this.touch(binding); }
        if (event.event === 'trust.requested' && typeof event.data['trustRequestId'] === 'string') { this.trustBindings.set(event.data['trustRequestId'], binding); this.touch(binding); }
        if (event.event === 'turn.started' && typeof event.data['turnId'] === 'string') this.turnBindings.set(event.data['turnId'], binding);
        if (event.event === 'turn.completed' || event.event === 'turn.failed' || event.event === 'turn.cancelled') { const turnId = typeof event.data['turnId'] === 'string' ? event.data['turnId'] : undefined; if (turnId !== undefined) this.turnBindings.delete(turnId); this.touch(binding); }
        this.handler.onEvent(projectRoot, event);
      },
      onHostRequest: request => this.handler.onHostRequest === undefined ? Promise.resolve({ version: 2, type: 'host.response', requestId: request.requestId, tool: request.tool, ok: false, error: { code: 'HOST_UNAVAILABLE', category: 'execution', message: 'The Desktop host is unavailable.', retryable: false } }) : this.handler.onHostRequest(projectRoot, request),
      onDiagnostic: diagnostic => this.handler.onDiagnostic?.(projectRoot, diagnostic),
      onExit: error => {
        const approvalIds = [...this.approvalBindings.entries()].filter(([, candidate]) => candidate === binding).map(([approvalId]) => approvalId);
        for (const approvalId of approvalIds) this.approvalBindings.delete(approvalId);
        this.handler.onExit?.(projectRoot, error, binding.sessionId, approvalIds);
        this.scheduleRecovery(binding);
      },
    };
    binding = { key, projectRoot, process: new CliAgentProcess({ cwd: projectRoot, ...resolveCliInvocation() }, eventHandler) }; this.processes.set(key, binding); this.touch(binding); return binding;
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
  private scheduleRecovery(binding: ProcessBinding): void { const attempt = this.recoveryAttempts.get(binding.key) ?? 0; if (attempt >= 3 || this.recoveryTimers.has(binding.key)) return; const delayMs = 1_000 * 2 ** attempt; this.recoveryAttempts.set(binding.key, attempt + 1); this.handler.onDiagnostic?.(binding.projectRoot, { kind: 'protocol', message: `CLI recovery scheduled in ${delayMs}ms (attempt ${attempt + 1}/3).` }); const timer = setTimeout(() => { this.recoveryTimers.delete(binding.key); void binding.process.initialize().then(() => { this.recoveryAttempts.delete(binding.key); }).catch(error => { this.handler.onDiagnostic?.(binding.projectRoot, { kind: 'protocol', message: error instanceof Error ? error.message : 'CLI recovery failed.' }); this.scheduleRecovery(binding); }); }, delayMs); this.recoveryTimers.set(binding.key, timer); }
  private removeBinding(binding: ProcessBinding): void { this.processes.delete(binding.key); if (binding.sessionId !== undefined) this.sessionBindings.delete(binding.sessionId); for (const [id, candidate] of this.turnBindings) if (candidate === binding) this.turnBindings.delete(id); for (const [id, candidate] of this.approvalBindings) if (candidate === binding) this.approvalBindings.delete(id); for (const [id, candidate] of this.trustBindings) if (candidate === binding) this.trustBindings.delete(id); this.clearIdle(binding.key); }
  private async shutdownBinding(binding: ProcessBinding, reason: string): Promise<void> { this.removeBinding(binding); this.clearRecovery(binding.key); await binding.process.shutdown(reason); }
  private clearRecovery(key: string): void { const timer = this.recoveryTimers.get(key); if (timer !== undefined) clearTimeout(timer); this.recoveryTimers.delete(key); this.recoveryAttempts.delete(key); }
  private touch(binding: ProcessBinding): void { this.clearIdle(binding.key); const timer = setTimeout(() => { this.idleTimers.delete(binding.key); void this.expireIdle(binding); }, this.idleTimeoutMs); timer.unref?.(); this.idleTimers.set(binding.key, timer); }
  private async expireIdle(binding: ProcessBinding): Promise<void> {
    if (this.processes.get(binding.key) !== binding || this.recoveryTimers.has(binding.key)) return;
    if ([...this.turnBindings.values(), ...this.approvalBindings.values(), ...this.trustBindings.values()].includes(binding)) { this.touch(binding); return; }
    await this.shutdownBinding(binding, 'idle-timeout').catch(error => this.handler.onDiagnostic?.(binding.projectRoot, { kind: 'protocol', message: error instanceof Error ? error.message : 'Idle CLI process shutdown failed.' }));
  }
  private clearIdle(key: string): void { const timer = this.idleTimers.get(key); if (timer !== undefined) clearTimeout(timer); this.idleTimers.delete(key); }
  private async cachedProtocolResult(cwd: string, kind: string, ttlMs: number, load: () => Promise<unknown>): Promise<unknown> { const canonical = await requireDirectory(cwd); const key = `agent:${kind}:${canonical}`; const cached = await this.cache?.get<unknown>(key); if (cached !== undefined) return cached; const value = await load(); await this.cache?.set(key, value, ttlMs); return value; }
}

function extractSessionId(value: unknown): string | undefined { if (!isRecord(value) || !isRecord(value['session'])) return undefined; return typeof value['session']['id'] === 'string' ? value['session']['id'] : undefined; }
function extractTurnId(value: unknown): string | undefined { return isRecord(value) && typeof value['turnId'] === 'string' ? value['turnId'] : undefined; }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
