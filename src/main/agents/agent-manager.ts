import { CliAgentProcess, type CliAgentEventHandler } from './cli-agent-process.js';
import { resolveCliExecutable } from './cli-resolver.js';
import type { DesktopAgentResult, DesktopEvent, DesktopExecutionPolicy, DesktopHostRequest, DesktopHostResponse, DesktopSkillSelection } from '../../contracts/agent-protocol/v1/desktop.js';
import { requireDirectory } from '../security/path-policy.js';
import { CACHE_TTL_MS } from '../cache/cache-policy.js';
import type { PersistentCache } from '../cache/persistent-cache.js';
import { INTERACTIVE_DESKTOP_EXECUTION_POLICY } from './desktop-execution-policy.js';

export interface AgentManagerHandler {
  onEvent(cwd: string, event: DesktopEvent): void;
  onHostRequest?(cwd: string, request: DesktopHostRequest): Promise<DesktopHostResponse>;
  onDiagnostic?(cwd: string, diagnostic: { kind: 'stderr' | 'protocol'; message: string }): void;
  onExit?(cwd: string, error: Error): void;
}

export interface CliAttachmentInput {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  path: string;
}

export class AgentManager {
  private readonly processes = new Map<string, CliAgentProcess>();
  private readonly recoveryAttempts = new Map<string, number>();
  private readonly recoveryTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(private readonly handler: AgentManagerHandler, private readonly cache?: PersistentCache) {}

  async initialize(cwd: string): Promise<DesktopAgentResult> {
    const process = this.getOrCreate(await requireDirectory(cwd));
    return process.initialize();
  }

  async sessionCreate(cwd: string, input: { model?: string; name?: string }): Promise<unknown> { return this.request(cwd, 'session.create', input); }
  async sessionList(cwd: string): Promise<unknown> { return this.request(cwd, 'session.list', {}); }
  async sessionResume(cwd: string, sessionId: string): Promise<unknown> { return this.request(cwd, 'session.resume', { sessionId }); }
  async turnStart(cwd: string, input: { sessionId: string; prompt: string; model?: string; runId?: string; execution?: DesktopExecutionPolicy; skills?: DesktopSkillSelection; attachments?: CliAttachmentInput[] }): Promise<unknown> {
    const process = this.getOrCreate(await requireDirectory(cwd));
    const attachmentIds: string[] = [];
    for (const attachment of input.attachments ?? []) {
      await process.uploadAttachment(attachment);
      attachmentIds.push(attachment.id);
    }
    return process.request('turn.start', { sessionId: input.sessionId, prompt: input.prompt, ...(input.model === undefined ? {} : { model: input.model }), ...(input.runId === undefined ? {} : { runId: input.runId }), ...(input.skills === undefined ? {} : { skills: [...input.skills] }), execution: input.execution ?? INTERACTIVE_DESKTOP_EXECUTION_POLICY, ...(attachmentIds.length === 0 ? {} : { attachmentIds }) });
  }
  async turnCancel(cwd: string, turnId: string): Promise<unknown> { return this.request(cwd, 'turn.cancel', { turnId }); }
  async approvalRespond(cwd: string, input: { approvalId: string; approved: boolean }): Promise<unknown> { return this.request(cwd, 'approval.respond', input); }
  async trustRespond(cwd: string, input: { trustRequestId: string; trusted: boolean }): Promise<unknown> { return this.request(cwd, 'trust.respond', input); }
  async modelList(cwd: string): Promise<unknown> { return this.cachedProtocolResult(cwd, 'models', CACHE_TTL_MS.models, () => this.request(cwd, 'model.list', {})); }
  async commandList(cwd: string): Promise<unknown> { return this.cachedProtocolResult(cwd, 'commands', CACHE_TTL_MS.models, () => this.request(cwd, 'command.list', {})); }
  async commandExecute(cwd: string, input: Record<string, unknown>): Promise<unknown> { return this.request(cwd, 'command.execute', input); }
  async commandCancel(cwd: string, commandId: string): Promise<unknown> { return this.request(cwd, 'command.cancel', { commandId }); }

  async shutdown(cwd: string): Promise<void> {
    const canonical = await requireDirectory(cwd);
    const process = this.processes.get(canonical);
    if (process === undefined) return;
    this.processes.delete(canonical);
    this.clearRecovery(canonical);
    await process.shutdown();
  }

  async shutdownAll(): Promise<void> {
    const processes = [...this.processes.entries()];
    this.processes.clear();
    for (const timer of this.recoveryTimers.values()) clearTimeout(timer);
    this.recoveryTimers.clear();
    await Promise.allSettled(processes.map(([, process]) => process.shutdown()));
  }

  private getOrCreate(cwd: string): CliAgentProcess {
    const existing = this.processes.get(cwd);
    if (existing !== undefined) return existing;
    const eventHandler: CliAgentEventHandler = {
      onEvent: event => this.handler.onEvent(cwd, event),
      onHostRequest: request => this.handler.onHostRequest === undefined
        ? Promise.resolve({ version: 1, type: 'host.response', requestId: request.requestId, tool: 'browser', ok: false, error: { code: 'BROWSER_HOST_UNAVAILABLE', category: 'browser', message: 'The Desktop browser host is unavailable.', retryable: false } })
        : this.handler.onHostRequest(cwd, request),
      onDiagnostic: diagnostic => this.handler.onDiagnostic?.(cwd, diagnostic),
      onExit: error => { this.handler.onExit?.(cwd, error); this.scheduleRecovery(cwd, agentProcess); },
    };
    const agentProcess = new CliAgentProcess({ cwd, executable: resolveCliExecutable() }, eventHandler);
    this.processes.set(cwd, agentProcess);
    return agentProcess;
  }

  private scheduleRecovery(cwd: string, process: CliAgentProcess): void {
    const attempt = this.recoveryAttempts.get(cwd) ?? 0;
    if (attempt >= 3 || this.recoveryTimers.has(cwd)) return;
    const delayMs = 1_000 * 2 ** attempt;
    this.recoveryAttempts.set(cwd, attempt + 1);
    this.handler.onDiagnostic?.(cwd, { kind: 'protocol', message: `CLI recovery scheduled in ${delayMs}ms (attempt ${attempt + 1}/3).` });
    const timer = setTimeout(() => {
      this.recoveryTimers.delete(cwd);
      void process.initialize().then(() => { this.recoveryAttempts.delete(cwd); }).catch(error => { this.handler.onDiagnostic?.(cwd, { kind: 'protocol', message: error instanceof Error ? error.message : 'CLI recovery failed.' }); this.scheduleRecovery(cwd, process); });
    }, delayMs);
    this.recoveryTimers.set(cwd, timer);
  }

  private clearRecovery(cwd: string): void { const timer = this.recoveryTimers.get(cwd); if (timer !== undefined) clearTimeout(timer); this.recoveryTimers.delete(cwd); this.recoveryAttempts.delete(cwd); }

  private async request(cwd: string, method: string, input: Record<string, unknown>): Promise<unknown> {
    return (this.getOrCreate(await requireDirectory(cwd))).request(method, input);
  }

  private async cachedProtocolResult(cwd: string, kind: string, ttlMs: number, load: () => Promise<unknown>): Promise<unknown> {
    const canonical = await requireDirectory(cwd);
    const key = `agent:${kind}:${canonical}`;
    const cached = await this.cache?.get<unknown>(key);
    if (cached !== undefined) return cached;
    const value = await load();
    await this.cache?.set(key, value, ttlMs);
    return value;
  }
}
