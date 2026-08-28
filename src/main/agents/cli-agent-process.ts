import { randomUUID } from 'node:crypto';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { once } from 'node:events';
import { desktopRequestSchema, parseDesktopEvent, parseDesktopHostRequest, parseDesktopResponse, type DesktopAgentResult, type DesktopEvent, type DesktopHostRequest, type DesktopHostResponse } from '../../contracts/agent-protocol/v1/desktop.js';

const MAX_JSONL_LINE_BYTES = 4 * 1024 * 1024;
const DESKTOP_ATTACHMENT_CHUNK_BYTES = 512 * 1024;
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const PROCESS_CLOSE_TIMEOUT_MS = 3_000;
const REQUIRED_DESKTOP_CAPABILITIES = ['execution-context', 'tool-allowlist', 'approval-reviews', 'lifecycle-controls', 'browser-host', 'execution-broker'] as const;

export interface CliAgentProcessOptions {
  cwd: string;
  executable: string;
  executableArgs?: readonly string[];
  environment?: NodeJS.ProcessEnv;
}

export interface CliAgentEventHandler {
  onEvent(event: DesktopEvent): void;
  onHostRequest?(request: DesktopHostRequest): Promise<DesktopHostResponse>;
  onDiagnostic?(diagnostic: { kind: 'stderr' | 'protocol'; message: string }): void;
  onExit?(error: CliAgentProcessError): void;
}

export class CliAgentProcess {
  private child: ChildProcessWithoutNullStreams | undefined;
  private lineBuffer = Buffer.alloc(0);
  private readonly pending = new Map<string, PendingRequest>();
  private stopping = false;
  private initialized = false;
  private initialization: Promise<DesktopAgentResult> | undefined;
  private initializationResult: DesktopAgentResult | undefined;

  constructor(private readonly options: CliAgentProcessOptions, private readonly handler: CliAgentEventHandler) {}

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

  private async performInitialization(): Promise<DesktopAgentResult> {
    if (this.initialized && this.initializationResult !== undefined) return this.initializationResult;
    this.ensureStarted();
    const result = await this.request('initialize', { client: 'lotagate-desktop', version: 2, browserHost: true, executionBroker: true });
    if (!isDesktopAgentResult(result)) throw new CliAgentProcessError('The CLI returned an invalid Desktop protocol handshake.');
    if (result.version !== 2) throw new CliAgentProcessError(`Unsupported Desktop protocol version: ${String(result.version)}.`);
    const missing = REQUIRED_DESKTOP_CAPABILITIES.filter(capability => !result.capabilities.includes(capability));
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
    if (child === undefined || this.stopping) throw new CliAgentProcessError('The CLI agent process is not available.');
    const id = randomUUID();
    const operation = new Promise<unknown>((resolve, reject) => this.pending.set(id, { method, resolve, reject }));
    try {
      await writeLine(child, desktopRequestSchema.parse({ version: 2, id, method, params: requestParams }));
    } catch (error) {
      this.pending.delete(id);
      throw new CliAgentProcessError('Unable to write to the CLI agent process.', error);
    }
    return operation;
  }

  async uploadAttachment(input: { id: string; name: string; mimeType: string; sizeBytes: number; path: string }): Promise<void> {
    if (input.sizeBytes <= 0 || input.sizeBytes > MAX_ATTACHMENT_BYTES) throw new CliAgentProcessError('The attachment exceeds the supported size limit.');
    await this.request('attachment.begin', { attachmentId: input.id, name: input.name, mimeType: input.mimeType, sizeBytes: input.sizeBytes });
    let index = 0;
    try {
      for await (const chunk of createReadStream(input.path, { highWaterMark: DESKTOP_ATTACHMENT_CHUNK_BYTES })) {
        await this.request('attachment.chunk', { attachmentId: input.id, index, dataBase64: Buffer.from(chunk).toString('base64') });
        index += 1;
      }
      await this.request('attachment.complete', { attachmentId: input.id });
    } catch (error) {
      throw new CliAgentProcessError(`Unable to upload attachment ${input.name}.`, error);
    }
  }

  async shutdown(): Promise<void> {
    if (this.child === undefined) return;
    try {
      await this.request('shutdown', {});
    } catch {
      // The process may already be exiting; close handling below remains authoritative.
    }
    this.stopping = true;
    const child = this.child;
    if (!child.killed) child.kill();
    const closed = await Promise.race([once(child, 'close').then(() => true), delay(PROCESS_CLOSE_TIMEOUT_MS).then(() => false)]);
    if (!closed && child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
      await Promise.race([once(child, 'close'), delay(PROCESS_CLOSE_TIMEOUT_MS)]);
    }
    this.rejectPending(new CliAgentProcessError('The CLI agent process was shut down.'));
    this.child = undefined;
    this.initialized = false;
    this.initializationResult = undefined;
  }

  private ensureStarted(): void {
    if (this.child !== undefined) return;
    this.stopping = false;
    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(this.options.executable, [...(this.options.executableArgs ?? []), 'agent', 'desktop'], {
        cwd: this.options.cwd,
        env: { ...process.env, ...this.options.environment },
        shell: false,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (error) {
      throw new CliAgentProcessError(`The CLI agent process failed to start: ${describeProcessError(error)}.`, error);
    }
    this.child = child;
    child.stdout.on('data', (chunk: Buffer | string) => this.consumeOutput(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    child.stderr.on('data', (chunk: Buffer | string) => this.handler.onDiagnostic?.({ kind: 'stderr', message: `CLI diagnostic output received (${Buffer.byteLength(chunk)} bytes).` }));
    child.on('error', (error) => this.failProcess(new CliAgentProcessError(`The CLI agent process failed to start: ${describeProcessError(error)}.`, error)));
    child.on('close', (code, signal) => this.failProcess(new CliAgentProcessError(`The CLI agent process exited (${code ?? 'unknown'}${signal === null ? '' : `, ${signal}`}).`)));
  }

  private consumeOutput(chunk: Buffer): void {
    this.lineBuffer = Buffer.concat([this.lineBuffer, chunk]);
    if (this.lineBuffer.byteLength > MAX_JSONL_LINE_BYTES && !this.lineBuffer.includes(0x0a)) {
      this.handler.onDiagnostic?.({ kind: 'protocol', message: 'CLI JSONL line exceeded the desktop limit.' });
      this.failProcess(new CliAgentProcessError('The CLI returned an oversized JSONL line.'));
      return;
    }
    let newline = this.lineBuffer.indexOf(0x0a);
    while (newline >= 0) {
      const line = this.lineBuffer.subarray(0, newline);
      this.lineBuffer = this.lineBuffer.subarray(newline + 1);
      if (line.byteLength > MAX_JSONL_LINE_BYTES) {
        this.failProcess(new CliAgentProcessError('The CLI returned an oversized JSONL line.'));
        return;
      }
      this.consumeLine(line.toString('utf8').replace(/\r$/u, ''));
      newline = this.lineBuffer.indexOf(0x0a);
    }
  }

  private consumeLine(line: string): void {
    if (line.trim().length === 0) return;
    let value: unknown;
    try { value = JSON.parse(line); } catch { this.handler.onDiagnostic?.({ kind: 'protocol', message: 'CLI returned invalid JSONL.' }); return; }
    try {
      if (isHostRequest(value)) {
        const request = parseDesktopHostRequest(value);
        void this.handleHostRequest(request);
        return;
      }
      if (isResponse(value)) {
        const response = parseDesktopResponse(value);
        const pending = this.pending.get(response.id);
        if (pending === undefined) {
          this.handler.onDiagnostic?.({ kind: 'protocol', message: `CLI returned an unknown response id for ${response.method}.` });
          return;
        }
        this.pending.delete(response.id);
        if (response.ok) pending.resolve(response.result);
        else pending.reject(new CliAgentProcessError(response.error?.message ?? 'The CLI rejected the request.'));
        return;
      }
      this.handler.onEvent(parseDesktopEvent(value));
    } catch {
      this.handler.onDiagnostic?.({ kind: 'protocol', message: 'CLI returned an invalid Desktop protocol message.' });
    }
  }

  private async handleHostRequest(request: DesktopHostRequest): Promise<void> {
    const child = this.child;
    if (child === undefined || this.stopping) return;
    let response: DesktopHostResponse;
    try {
      response = this.handler.onHostRequest === undefined
        ? deniedHostResponse(request, 'The Desktop browser host is unavailable.')
        : await this.handler.onHostRequest(request);
    } catch (error) {
      response = deniedHostResponse(request, error instanceof Error ? error.message : 'The Desktop browser host failed.');
    }
    try { await writeLine(child, response); }
    catch (error) { this.failProcess(new CliAgentProcessError('Unable to respond to the CLI browser request.', error)); }
  }

  private failProcess(error: CliAgentProcessError): void {
    if (this.child === undefined && !this.initialized) return;
    this.rejectPending(error);
    this.child = undefined;
    this.initialized = false;
    this.initializationResult = undefined;
    if (!this.stopping) this.handler.onExit?.(error);
  }

  private rejectPending(error: CliAgentProcessError): void {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
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
    && record['version'] === 2
    && Array.isArray(capabilities)
    && capabilities.every((item: unknown) => typeof item === 'string');
}
function isResponse(value: unknown): value is { type: 'response'; id: string } { return typeof value === 'object' && value !== null && (value as Record<string, unknown>)['type'] === 'response'; }
function isHostRequest(value: unknown): boolean { return typeof value === 'object' && value !== null && (value as Record<string, unknown>)['type'] === 'host.request'; }
function deniedHostResponse(request: DesktopHostRequest, message: string): DesktopHostResponse { return { version: 2, type: 'host.response', requestId: request.requestId, tool: request.tool, ok: false, error: { code: 'HOST_UNAVAILABLE', category: 'execution', message, retryable: false } }; }
async function writeLine(child: ChildProcessWithoutNullStreams, value: unknown): Promise<void> { if (child.stdin.write(`${JSON.stringify(value)}\n`)) return; await once(child.stdin, 'drain'); }
function delay(milliseconds: number): Promise<void> { return new Promise(resolve => setTimeout(resolve, milliseconds)); }
type PendingRequest = { method: string; resolve: (value: unknown) => void; reject: (error: CliAgentProcessError) => void };

function describeProcessError(error: unknown): string {
  if (!(error instanceof Error)) return 'unknown process error';
  const code = 'code' in error && typeof error.code === 'string' ? ` (${error.code})` : '';
  return `${error.message}${code}`;
}
