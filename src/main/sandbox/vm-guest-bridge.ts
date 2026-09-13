import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { DESKTOP_RUNTIME_LIMITS } from '../../contracts/runtime-limits.js';
import { terminateDesktopProcess } from '../process/process-termination.js';
import type { VmRuntimeExecuteInput, VmRuntimeExecutionResult } from './vm-types.js';

interface PendingRequest {
  readonly resolve: (value: VmRuntimeExecutionResult) => void;
  readonly reject: (error: Error) => void;
  readonly timer: ReturnType<typeof setTimeout>;
  cleanup?: () => void;
}

/**
 * Authenticated JSONL channel to one already-started guest environment.
 * Keeping the channel alive is what makes an environment reusable across
 * turns without recreating a runtime for every tool call.
 */
export class VmGuestBridge {
  private readonly pending = new Map<string, PendingRequest>();
  private buffer = '';
  private closed = false;
  private closing: Promise<void> | undefined;

  constructor(
    private readonly child: ChildProcessWithoutNullStreams,
    private readonly authToken: string,
    private readonly maxLineBytes = DESKTOP_RUNTIME_LIMITS.cliJsonlLineBytes,
  ) {
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => this.consume(chunk));
    child.stderr.on('data', () => undefined);
    child.once('error', error => this.fail(error instanceof VmGuestProcessError
      ? error
      : new VmGuestProcessError(error instanceof Error ? `The VM guest channel failed: ${error.message}` : 'The VM guest channel failed.')));
    child.once('close', code => this.fail(new VmGuestProcessError(`The VM guest channel exited with code ${String(code ?? -1)}.`)));
  }

  execute(input: VmRuntimeExecuteInput): Promise<VmRuntimeExecutionResult> {
    if (this.closed) return Promise.reject(new VmGuestProcessError('The VM guest channel is closed.'));
    if (input.signal?.aborted === true) return Promise.reject(new Error('VM sandbox execution was cancelled.'));
    const requestId = randomUUID();
    const requestedTimeout = input.timeoutMs ?? DESKTOP_RUNTIME_LIMITS.defaultExecutionTimeoutMs;
    const timeoutMs = Math.min(Math.max(Math.trunc(requestedTimeout), DESKTOP_RUNTIME_LIMITS.minExecutionTimeoutMs), DESKTOP_RUNTIME_LIMITS.sandboxMaxExecutionTimeoutMs);
    return new Promise((resolve, reject) => {
      const pending: PendingRequest = {
        resolve,
        reject,
        timer: setTimeout(() => {
          pending.cleanup?.();
          this.pending.delete(requestId);
          reject(new Error(`VM guest execution timed out after ${String(timeoutMs)}ms.`));
          void this.close();
        }, timeoutMs),
      };
      this.pending.set(requestId, pending);
      if (input.signal !== undefined) {
        const onAbort = (): void => {
          if (!this.pending.has(requestId)) return;
          clearTimeout(pending.timer);
          this.pending.delete(requestId);
          reject(new Error('VM sandbox execution was cancelled.'));
          void this.close();
        };
        pending.cleanup = () => input.signal?.removeEventListener('abort', onAbort);
        input.signal.addEventListener('abort', onAbort, { once: true });
        if (input.signal.aborted) {
          onAbort();
          return;
        }
      }
      const message = JSON.stringify({ requestId, auth: this.authToken, action: input.action, params: input.params });
      try {
        if (!this.child.stdin.write(`${message}\n`, 'utf8')) this.child.stdin.once('drain', () => undefined);
      } catch (error) {
        clearTimeout(pending.timer);
        pending.cleanup?.();
        this.pending.delete(requestId);
        reject(error instanceof Error ? error : new VmGuestProcessError('The VM guest request could not be written.'));
        void this.close();
        return;
      }
    });
  }

  async close(): Promise<void> {
    if (this.closing !== undefined) return this.closing;
    this.closed = true;
    this.closing = terminateDesktopProcess(this.child).catch(() => undefined).then(() => undefined);
    await this.closing;
    this.fail(new VmGuestProcessError('The VM guest channel was closed.'));
  }

  private consume(chunk: string): void {
    if (this.closed) return;
    this.buffer += chunk;
    while (true) {
      const newline = this.buffer.indexOf('\n');
      if (newline < 0) {
        if (Buffer.byteLength(this.buffer, 'utf8') > this.maxLineBytes) this.rejectOversizedLine();
        return;
      }
      const rawLine = this.buffer.slice(0, newline);
      this.buffer = this.buffer.slice(newline + 1);
      if (Buffer.byteLength(rawLine, 'utf8') > this.maxLineBytes) {
        this.rejectOversizedLine();
        return;
      }
      const line = rawLine.trim();
      if (line.length === 0) continue;
      this.resolveLine(line);
      if (this.closed) return;
    }
  }

  private rejectOversizedLine(): void {
    this.fail(new VmGuestProcessError('The VM guest returned an oversized JSONL response.'));
    void this.close();
  }

  private resolveLine(line: string): void {
    let parsed: unknown;
    try { parsed = JSON.parse(line); }
    catch { this.fail(new VmGuestProcessError('The VM guest returned malformed JSONL.')); void this.close(); return; }
    if (!isRecord(parsed) || typeof parsed['requestId'] !== 'string' || typeof parsed['ok'] !== 'boolean') {
      this.fail(new VmGuestProcessError('The VM guest returned an incomplete response.'));
      void this.close();
      return;
    }
    const request = this.pending.get(parsed['requestId']);
    if (request === undefined) return;
    this.pending.delete(parsed['requestId']);
    clearTimeout(request.timer);
    request.cleanup?.();
    if (parsed['ok'] !== true) {
      request.reject(new Error(typeof parsed['error'] === 'string' ? parsed['error'] : 'The VM guest rejected the request.'));
      return;
    }
    const fileChange = parsed['fileChange'];
    if (fileChange !== undefined && (!isRecord(fileChange) || typeof fileChange['path'] !== 'string' || (fileChange['kind'] !== 'created' && fileChange['kind'] !== 'modified'))) {
      request.reject(new VmGuestProcessError('The VM guest returned an invalid file change.'));
      return;
    }
    request.resolve({ result: parsed['result'], ...(fileChange === undefined ? {} : { fileChange: { path: fileChange['path'] as string, kind: fileChange['kind'] as 'created' | 'modified' } }) });
  }

  private fail(error: Error): void {
    if (this.closed && this.pending.size === 0) return;
    this.closed = true;
    for (const request of this.pending.values()) { clearTimeout(request.timer); request.cleanup?.(); request.reject(error); }
    this.pending.clear();
  }
}

export class VmGuestProcessError extends Error {
  constructor(message: string) { super(message); this.name = 'VmGuestProcessError'; }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
