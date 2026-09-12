import { randomUUID } from 'node:crypto';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { desktopHostCancelSchema, desktopRequestSchema, parseDesktopEvent, parseDesktopHostRequest, parseDesktopResponse, type DesktopAgentResult, type DesktopEvent, type DesktopHostCancel, type DesktopHostRequest, type DesktopHostResponse } from '../../contracts/agent-protocol/v1/desktop.js';
import { cliRequestTimeout, CLI_DEFAULT_REQUEST_TIMEOUT_MS } from './cli-agent-timeouts.js';
import { terminateDesktopProcess } from '../process/process-termination.js';
import { DESKTOP_RUNTIME_LIMITS } from '../../contracts/runtime-limits.js';
import { REQUIRED_DESKTOP_CAPABILITIES } from './agent-constants.js';
import type { DesktopHostCapabilities } from '../../contracts/agent-protocol/v1/host-capabilities.js';

export interface CliAgentProcessOptions {
  cwd: string;
  executable: string;
  executableArgs?: readonly string[];
  environment?: NodeJS.ProcessEnv;
  computerHost?: boolean;
  documentHost?: boolean;
  hostCapabilities?: DesktopHostCapabilities;
}

export interface CliAgentEventHandler {
  onEvent(event: DesktopEvent): void;
  onHostRequest?(request: DesktopHostRequest, signal?: AbortSignal): Promise<DesktopHostResponse>;
  onDiagnostic?(diagnostic: CliAgentDiagnostic): void;
  onExit?(error: CliAgentProcessError): void;
}

export interface CliAgentDiagnostic {
  kind: 'stderr' | 'protocol';
  message: string;
  severity?: 'info' | 'error';
  sessionId?: string;
  turnId?: string;
}

export class CliAgentProcess {
  private child: ChildProcessWithoutNullStreams | undefined;
  private lineBuffer = Buffer.alloc(0);
  private readonly pending = new Map<string, PendingRequest>();
  private readonly activeHostRequests = new Map<string, AbortController>();
  private stopping = false;
  private initialized = false;
  private initialization: Promise<DesktopAgentResult> | undefined;
  private initializationResult: DesktopAgentResult | undefined;
  private generation = 0;

  constructor(private readonly options: CliAgentProcessOptions, private readonly handler: CliAgentEventHandler) {}

  isAvailable(): boolean {
    const child = this.child;
    return child !== undefined && !this.stopping && child.exitCode === null && child.signalCode === null;
  }

  async initialize(): Promise<DesktopAgentResult> {
    if (this.initialized && this.initializationResult !== undefined) return this.initializationResult;
    if (this.initialization !== undefined) return this.initialization;
    const initialization = this.performInitialization();
    this.initialization = initialization;
    try {
      return await initialization;
    } finally {
      if (this.initialization === initialization) this.initialization = undefined;
    }
  }

  supportsCapability(capability: string): boolean {
    return this.initializationResult?.capabilities.includes(capability) === true;
  }

  private async performInitialization(): Promise<DesktopAgentResult> {
    if (this.initialized && this.initializationResult !== undefined) return this.initializationResult;
    this.ensureStarted();
    const result = await this.request('initialize', { client: 'lotagate-desktop', version: 1, browserHost: true, executionBroker: true, computerHost: this.options.computerHost === true, documentHost: this.options.documentHost === true, ...(this.options.hostCapabilities === undefined ? {} : { hostCapabilities: this.options.hostCapabilities }) });
    if (!isDesktopAgentResult(result)) throw new CliAgentProcessError('The CLI returned an invalid Desktop protocol handshake.');
    if (result.version !== 1) throw new CliAgentProcessError(`Unsupported Desktop protocol version: ${String(result.version)}.`);
    const missing = [...REQUIRED_DESKTOP_CAPABILITIES, ...(this.options.computerHost === true ? ['computer-host'] : []), ...(this.options.documentHost === true ? ['document-host'] : [])].filter(capability => !result.capabilities.includes(capability));
    if (missing.length > 0) {
      await this.shutdown();
      throw new CliAgentProcessError(`The CLI does not support the required Desktop execution protocol. Missing capabilities: ${missing.join(', ')}.`);
    }
    this.initialized = true;
    this.initializationResult = result;
    return result;
  }

  async request(method: string, requestParams: Record<string, unknown>): Promise<unknown> {
    this.ensureStarted();
    const child = this.child;
    if (child === undefined || (this.stopping && method !== 'shutdown')) throw new CliAgentProcessError('The CLI agent process is not available.');
    const generation = this.generation;
    const id = randomUUID();
    const writeController = new AbortController();
    const operation = new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!this.pending.delete(id)) return;
        const error = new CliAgentProcessError(`The CLI request timed out (method=${method}, timeoutMs=${cliRequestTimeout(method)}).`);
        this.handler.onDiagnostic?.({ kind: 'protocol', severity: 'error', message: error.message, ...requestContext(requestParams) });
        writeController.abort(error);
        reject(error);
        this.failProcess(error, child, generation);
      }, cliRequestTimeout(method));
      this.pending.set(id, { method, requestParams, resolve, reject, timer });
    });
    try {
      await writeLine(child, desktopRequestSchema.parse({ version: 1, id, method, params: requestParams }), writeController.signal, CLI_DEFAULT_REQUEST_TIMEOUT_MS);
      this.handler.onDiagnostic?.({ kind: 'protocol', message: `CLI request sent (method=${method}, id=${id}, pid=${child.pid ?? 'unknown'}).`, ...requestContext(requestParams) });
    } catch (error) {
      const pending = this.pending.get(id);
      if (pending !== undefined) {
        clearTimeout(pending.timer);
        this.pending.delete(id);
        const writeError = error instanceof CliAgentProcessError ? error : new CliAgentProcessError('Unable to write to the CLI agent process.', error);
        pending.reject(writeError);
        this.failProcess(writeError, child, generation);
      }
    }
    return operation;
  }

  async uploadAttachment(input: { id: string; sessionId: string; name: string; mimeType: string; sizeBytes: number; path: string; storageName?: string }): Promise<void> {
    if (input.sizeBytes <= 0 || input.sizeBytes > DESKTOP_RUNTIME_LIMITS.attachmentBytes) throw new CliAgentProcessError('The attachment exceeds the supported size limit.');
    await this.request('attachment.begin', { attachmentId: input.id, sessionId: input.sessionId, name: input.name, mimeType: input.mimeType, sizeBytes: input.sizeBytes, ...(input.storageName === undefined ? {} : { storageName: input.storageName }) });
    let index = 0;
    try {
      for await (const chunk of createReadStream(input.path, { highWaterMark: DESKTOP_RUNTIME_LIMITS.cliAttachmentChunkBytes })) {
        await this.request('attachment.chunk', { attachmentId: input.id, index, dataBase64: Buffer.from(chunk).toString('base64') });
        index += 1;
      }
      await this.request('attachment.complete', { attachmentId: input.id });
    } catch (error) {
      throw new CliAgentProcessError(`Unable to upload attachment ${input.name}.`, error);
    }
  }

  async deleteAttachment(input: { sessionId: string; attachmentId: string }): Promise<void> {
    await this.request('attachment.delete', input);
  }

  async shutdown(reason = 'unspecified'): Promise<void> {
    const child = this.child;
    if (child === undefined) return;
    this.stopping = true;
    const generation = this.generation;
    this.abortActiveHostRequests();
    this.handler.onDiagnostic?.({ kind: 'protocol', message: `CLI shutdown requested (reason=${reason}, pid=${child.pid ?? 'unknown'}).` });
    try {
      await Promise.race([this.request('shutdown', {}), delay(cliRequestTimeout('shutdown'))]);
      this.handler.onDiagnostic?.({ kind: 'protocol', message: `CLI shutdown acknowledged (reason=${reason}).` });
    } catch (error) {
      this.handler.onDiagnostic?.({ kind: 'protocol', severity: 'error', message: `CLI shutdown request failed (reason=${reason}, message=${error instanceof Error ? error.message : String(error)}).` });
      // The process may already be exiting; close handling below remains authoritative.
    }
    this.handler.onDiagnostic?.({ kind: 'protocol', message: `CLI process termination started (reason=${reason}, pid=${child.pid ?? 'unknown'}).` });
    await terminateDesktopProcess(child).catch(error => this.handler.onDiagnostic?.({ kind: 'protocol', severity: 'error', message: `CLI process termination could not be confirmed (reason=${reason}, message=${error instanceof Error ? error.message : String(error)}).` }));
    this.rejectPending(new CliAgentProcessError('The CLI agent process was shut down.'));
    this.child = undefined;
    if (this.generation === generation) this.lineBuffer = Buffer.alloc(0);
    this.initialized = false;
    this.initializationResult = undefined;
    this.handler.onDiagnostic?.({ kind: 'protocol', message: `CLI process termination completed (reason=${reason}, pid=${child.pid ?? 'unknown'}, exitCode=${child.exitCode ?? 'unknown'}, signal=${child.signalCode ?? 'none'}).` });
  }

  private ensureStarted(): void {
    if (this.child !== undefined) return;
    this.stopping = false;
    this.lineBuffer = Buffer.alloc(0);
    const generation = ++this.generation;
    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(this.options.executable, [...(this.options.executableArgs ?? []), 'agent', 'desktop'], {
        cwd: this.options.cwd,
        env: { ...process.env, ...this.options.environment },
        shell: false,
        windowsHide: true,
        detached: process.platform !== 'win32',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (error) {
      throw new CliAgentProcessError(`The CLI agent process failed to start: ${describeProcessError(error)}.`, error);
    }
    this.child = child;
    this.handler.onDiagnostic?.({ kind: 'protocol', message: `CLI process spawned (pid=${child.pid ?? 'unknown'}, cwd=${this.options.cwd}).` });
    child.stdout.on('data', (chunk: Buffer | string) => this.consumeOutput(child, generation, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    child.stderr.on('data', (chunk: Buffer | string) => this.handler.onDiagnostic?.({ kind: 'stderr', severity: 'error', message: `CLI diagnostic output received: ${redactDiagnosticOutput(Buffer.isBuffer(chunk) ? chunk.toString('utf8') : chunk)}` }));
    child.on('error', (error) => {
      this.handler.onDiagnostic?.({ kind: 'protocol', severity: 'error', message: `CLI process error (pid=${child.pid ?? 'unknown'}, stopping=${this.stopping}, error=${describeProcessError(error)}).` });
      this.failProcess(new CliAgentProcessError(`The CLI agent process failed to start: ${describeProcessError(error)}.`, error), child, generation);
    });
    child.on('close', (code, signal) => {
      this.handler.onDiagnostic?.({ kind: 'protocol', severity: this.stopping ? 'info' : 'error', message: `CLI process closed (pid=${child.pid ?? 'unknown'}, code=${code ?? 'unknown'}, signal=${signal ?? 'none'}, stopping=${this.stopping}).` });
      this.failProcess(new CliAgentProcessError(`The CLI agent process exited (${code ?? 'unknown'}${signal === null ? '' : `, ${signal}`}).`), child, generation);
    });
  }

  private consumeOutput(child: ChildProcessWithoutNullStreams, generation: number, chunk: Buffer): void {
    if (this.child !== child || this.generation !== generation) return;
    this.lineBuffer = Buffer.concat([this.lineBuffer, chunk]);
    if (this.lineBuffer.byteLength > DESKTOP_RUNTIME_LIMITS.cliJsonlLineBytes && !this.lineBuffer.includes(0x0a)) {
      this.handler.onDiagnostic?.({ kind: 'protocol', severity: 'error', message: 'CLI JSONL line exceeded the desktop limit.' });
      this.failProcess(new CliAgentProcessError('The CLI returned an oversized JSONL line.'), child, generation);
      return;
    }
    let newline = this.lineBuffer.indexOf(0x0a);
    while (newline >= 0) {
      const line = this.lineBuffer.subarray(0, newline);
      this.lineBuffer = this.lineBuffer.subarray(newline + 1);
      if (line.byteLength > DESKTOP_RUNTIME_LIMITS.cliJsonlLineBytes) {
        this.failProcess(new CliAgentProcessError('The CLI returned an oversized JSONL line.'), child, generation);
        return;
      }
      this.consumeLine(line.toString('utf8').replace(/\r$/u, ''), child, generation);
      newline = this.lineBuffer.indexOf(0x0a);
    }
    if (this.lineBuffer.byteLength > 0) {
      this.lineBuffer = Buffer.from(this.lineBuffer);
    }
  }

  private consumeLine(line: string, child: ChildProcessWithoutNullStreams, generation: number): void {
    if (this.child !== child || this.generation !== generation) return;
    if (line.trim().length === 0) return;
    let value: unknown;
    try { value = JSON.parse(line); } catch { const error = new CliAgentProcessError('The CLI returned invalid JSONL.'); this.handler.onDiagnostic?.({ kind: 'protocol', severity: 'error', message: error.message }); this.failProcess(error, child, generation); return; }
    try {
      if (isHostRequest(value)) {
        const request = parseDesktopHostRequest(value);
        void this.handleHostRequest(request);
        return;
      }
      if (isHostCancel(value)) {
        this.activeHostRequests.get(parseHostCancel(value).requestId)?.abort();
        return;
      }
      if (isResponse(value)) {
        const response = parseDesktopResponse(value);
        const pending = this.pending.get(response.id);
        if (pending === undefined) {
          const error = new CliAgentProcessError(`The CLI returned an unknown response id for ${response.method}.`);
          this.handler.onDiagnostic?.({ kind: 'protocol', severity: 'error', message: error.message });
          this.failProcess(error, child, generation);
          return;
        }
        if (response.method !== pending.method) {
          const error = new CliAgentProcessError(`The CLI response method did not match the request (expected=${pending.method}, received=${response.method}).`);
          this.handler.onDiagnostic?.({ kind: 'protocol', severity: 'error', message: error.message, ...requestContext(pending.requestParams) });
          this.failProcess(error, child, generation);
          return;
        }
        this.pending.delete(response.id);
        clearTimeout(pending.timer);
        this.handler.onDiagnostic?.({ kind: 'protocol', message: `CLI response received (method=${response.method}, id=${response.id}, ok=${response.ok}).` });
        if (response.ok) pending.resolve(response.result);
        else pending.reject(new CliAgentProcessError(response.error?.message ?? 'The CLI rejected the request.'));
        return;
      }
      const event = parseDesktopEvent(value);
      this.handler.onDiagnostic?.({ kind: 'protocol', message: `CLI event received (event=${event.event}).`, ...eventContext(event) });
      this.handler.onEvent(event);
    } catch {
      this.handler.onDiagnostic?.({ kind: 'protocol', severity: 'error', message: 'CLI returned an invalid Desktop protocol message.' });
      this.failProcess(new CliAgentProcessError('The CLI returned an invalid Desktop protocol message.'), child, generation);
    }
  }

  private async handleHostRequest(request: DesktopHostRequest): Promise<void> {
    const child = this.child;
    if (child === undefined || this.stopping) return;
    const generation = this.generation;
    if (this.activeHostRequests.size >= DESKTOP_RUNTIME_LIMITS.maxConcurrentHostRequestsPerProcess) {
      const response = deniedHostResponse(request, 'The Desktop host is at capacity. Retry the host operation later.', 'HOST_CAPACITY_EXCEEDED');
      try { await writeLine(child, response, undefined, CLI_DEFAULT_REQUEST_TIMEOUT_MS); }
      catch (error) { this.failProcess(new CliAgentProcessError('Unable to respond to the CLI host capacity request.', error), child, generation); }
      return;
    }
    let response: DesktopHostResponse;
    const controller = new AbortController();
    this.activeHostRequests.set(request.requestId, controller);
    try {
      response = this.handler.onHostRequest === undefined
        ? deniedHostResponse(request, 'The Desktop host is unavailable.')
        : await this.handler.onHostRequest(request, controller.signal);
    } catch (error) {
      response = deniedHostResponse(request, error instanceof Error ? error.message : 'The Desktop host failed.');
    } finally {
      if (this.activeHostRequests.get(request.requestId) === controller) this.activeHostRequests.delete(request.requestId);
    }
    if (this.child !== child || this.generation !== generation || this.stopping) return;
    try { await writeLine(child, response, undefined, CLI_DEFAULT_REQUEST_TIMEOUT_MS); }
    catch (error) { this.failProcess(new CliAgentProcessError('Unable to respond to the CLI host request.', error), child, generation); }
  }

  private failProcess(error: CliAgentProcessError, sourceChild?: ChildProcessWithoutNullStreams, sourceGeneration = this.generation): void {
    if (sourceChild !== undefined && (this.child !== sourceChild || this.generation !== sourceGeneration)) return;
    if (this.child === undefined && !this.initialized) return;
    const child = this.child;
    this.abortActiveHostRequests();
    this.rejectPending(error);
    this.child = undefined;
    this.lineBuffer = Buffer.alloc(0);
    this.initialized = false;
    this.initializationResult = undefined;
    if (child !== undefined && !child.killed && child.exitCode === null && child.signalCode === null) void terminateDesktopProcess(child).catch(terminationError => this.handler.onDiagnostic?.({ kind: 'protocol', severity: 'error', message: `CLI process termination could not be confirmed (message=${terminationError instanceof Error ? terminationError.message : String(terminationError)}).` }));
    if (!this.stopping) this.handler.onExit?.(error);
  }

  private rejectPending(error: CliAgentProcessError): void {
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
    this.pending.clear();
  }

  private abortActiveHostRequests(): void {
    for (const controller of this.activeHostRequests.values()) controller.abort();
    this.activeHostRequests.clear();
  }
}

export class CliAgentProcessError extends Error {
  constructor(message: string, options?: unknown) { super(message, { cause: options }); this.name = 'CliAgentProcessError'; }
}

function isDesktopAgentResult(value: unknown): value is DesktopAgentResult {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  const capabilities = record['capabilities'];
  return record['protocol'] === 'lotagate.desktop'
    && record['version'] === 1
    && Array.isArray(capabilities)
    && capabilities.every((item: unknown) => typeof item === 'string');
}
function isResponse(value: unknown): value is { type: 'response'; id: string } { return typeof value === 'object' && value !== null && (value as Record<string, unknown>)['type'] === 'response'; }
function isHostRequest(value: unknown): boolean { return typeof value === 'object' && value !== null && (value as Record<string, unknown>)['type'] === 'host.request'; }
function isHostCancel(value: unknown): boolean { return typeof value === 'object' && value !== null && (value as Record<string, unknown>)['type'] === 'host.cancel'; }
function parseHostCancel(value: unknown): DesktopHostCancel { return desktopHostCancelSchema.parse(value); }
function deniedHostResponse(request: DesktopHostRequest, message: string, code = 'HOST_UNAVAILABLE'): DesktopHostResponse { return { version: 1, type: 'host.response', requestId: request.requestId, tool: request.tool, ok: false, error: { code, category: 'execution', message, retryable: code === 'HOST_CAPACITY_EXCEEDED' } }; }
async function writeLine(child: ChildProcessWithoutNullStreams, value: unknown, signal?: AbortSignal, timeoutMs = CLI_DEFAULT_REQUEST_TIMEOUT_MS): Promise<void> {
  const payload = `${JSON.stringify(value)}\n`;
  if (signal?.aborted === true) throw abortReason(signal);
  if (child.stdin.write(payload)) return;
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => finish(new Error(`The CLI stdin remained backpressured for ${timeoutMs}ms.`)), timeoutMs);
    const cleanup = (): void => {
      clearTimeout(timer);
      child.stdin.removeListener('drain', onDrain);
      child.stdin.removeListener('error', onError);
      child.stdin.removeListener('close', onClose);
      signal?.removeEventListener('abort', onAbort);
    };
    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error === undefined) resolve(); else reject(error);
    };
    const onDrain = (): void => finish();
    const onError = (error: Error): void => finish(error);
    const onClose = (): void => finish(new Error('The CLI stdin closed before the request was written.'));
    const onAbort = (): void => finish(abortReason(signal as AbortSignal));
    child.stdin.once('drain', onDrain);
    child.stdin.once('error', onError);
    child.stdin.once('close', onClose);
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted === true) onAbort();
  });
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new Error('The CLI request was cancelled.');
}
function delay(milliseconds: number): Promise<void> { return new Promise(resolve => setTimeout(resolve, milliseconds)); }
type PendingRequest = { method: string; requestParams: Record<string, unknown>; resolve: (value: unknown) => void; reject: (error: CliAgentProcessError) => void; timer: ReturnType<typeof setTimeout> };

function requestContext(params: Record<string, unknown>): Pick<CliAgentDiagnostic, 'sessionId' | 'turnId'> {
  return {
    ...(typeof params['sessionId'] === 'string' ? { sessionId: params['sessionId'] } : {}),
    ...(typeof params['turnId'] === 'string' ? { turnId: params['turnId'] } : {}),
  };
}

function eventContext(event: DesktopEvent): Pick<CliAgentDiagnostic, 'sessionId' | 'turnId'> {
  return requestContext(event.data);
}

function redactDiagnosticOutput(value: string): string {
  return value
    .replace(/Bearer\s+[^\s]+/giu, 'Bearer [REDACTED]')
    .replace(/sk-[A-Za-z0-9_-]{8,}/gu, '[REDACTED]')
    .replace(/((?:api[-_]?key|token|secret|password)\s*[:=]\s*)[^\s,;]+/giu, '$1[REDACTED]')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, 4_096) || '(empty stderr output)';
}

function describeProcessError(error: unknown): string {
  if (!(error instanceof Error)) return 'unknown process error';
  const code = 'code' in error && typeof error.code === 'string' ? ` (${error.code})` : '';
  return `${error.message}${code}`;
}
