import type { DesktopHostRequest, DesktopHostResponse } from '../../contracts/agent-protocol/v1/desktop.js';
import type { ComputerOverlay } from './computer-overlay.js';

export interface ComputerRuntime {
  execute(action: string, params: Record<string, unknown>, signal?: AbortSignal): Promise<unknown>;
  close?(): Promise<void>;
}

/** Serializes native input per session/window and owns the visible activity indicator. */
export class ComputerHostToolBroker {
  private readonly queues = new Map<string, Promise<void>>();
  private readonly active = new Map<string, { cwd: string; sessionId: string; controller: AbortController }>();

  constructor(private readonly runtime: ComputerRuntime, private readonly overlay?: ComputerOverlay) {}

  async handle(cwd: string, request: DesktopHostRequest, signal?: AbortSignal): Promise<DesktopHostResponse> {
    if (request.tool !== 'computer') return this.error(request, 'COMPUTER_TOOL_MISMATCH', 'The Computer broker received a non-computer request.');
    const key = `${cwd}\u0000${request.sessionId}\u0000${typeof request.params['windowId'] === 'string' ? request.params['windowId'] : 'global'}`;
    const previous = this.queues.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>(resolve => { release = resolve; });
    const queued = previous.then(() => current);
    this.queues.set(key, queued);
    await previous;
    let abort: (() => void) | undefined;
    try {
      if (signal?.aborted) return this.error(request, 'COMPUTER_CANCELLED', 'The Computer action was cancelled.');
      this.overlay?.show();
      const controller = new AbortController();
      abort = (): void => controller.abort();
      signal?.addEventListener('abort', abort, { once: true });
      this.active.set(request.requestId, { cwd, sessionId: request.sessionId, controller });
      const result = await this.runtime.execute(request.action, request.params, controller.signal);
      return { version: 1, type: 'host.response', requestId: request.requestId, tool: 'computer', executionBoundary: 'host', ok: true, result };
    } catch (error) {
      return this.error(request, signal?.aborted ? 'COMPUTER_CANCELLED' : 'COMPUTER_EXECUTION_FAILED', error instanceof Error ? error.message : 'Computer action failed.');
    } finally {
      const current = this.active.get(request.requestId);
      if (current !== undefined) current.controller.abort();
      this.active.delete(request.requestId);
      if (abort !== undefined) signal?.removeEventListener('abort', abort);
      this.overlay?.hide();
      release();
      if (this.queues.get(key) === queued) this.queues.delete(key);
    }
  }

  async close(): Promise<void> {
    for (const active of this.active.values()) active.controller.abort();
    this.active.clear();
    this.overlay?.hide();
    await this.runtime.close?.();
    this.overlay?.destroy();
  }

  cancelForSession(cwd: string, sessionId: string): void {
    for (const active of this.active.values()) if (active.cwd === cwd && active.sessionId === sessionId) active.controller.abort();
  }

  private error(request: DesktopHostRequest, code: string, message: string, retryable = false): DesktopHostResponse {
    return { version: 1, type: 'host.response', requestId: request.requestId, tool: 'computer', executionBoundary: 'host', ok: false, error: { code, category: 'computer', message: redact(message), retryable } };
  }
}

function redact(value: string): string {
  return value.replace(/Bearer\s+[^\s]+/giu, 'Bearer [REDACTED]').replace(/sk-[A-Za-z0-9_-]{8,}/gu, '[REDACTED]');
}
