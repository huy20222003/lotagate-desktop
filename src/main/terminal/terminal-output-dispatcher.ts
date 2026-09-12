import type { TerminalSessionOutput } from '../../contracts/ipc/v1/workspace.js';
import { DESKTOP_RUNTIME_LIMITS } from '../../contracts/runtime-limits.js';

interface TerminalOutputSender {
  isDestroyed(): boolean;
  send(channel: string, output: TerminalSessionOutput): void;
}

/** Coalesces PTY bursts and bounds output retained while the renderer mounts. */
export class TerminalOutputDispatcher {
  private buffer = '';
  private bufferBytes = 0;
  private truncated = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private closed = false;

  constructor(private readonly sender: TerminalOutputSender, private sessionId: string) {}

  setSessionId(sessionId: string): void { this.sessionId = sessionId; }

  push(output: TerminalSessionOutput): void {
    if (this.closed || output.data.length === 0) return;
    const remaining = DESKTOP_RUNTIME_LIMITS.terminalOutputBufferBytes - this.bufferBytes;
    if (remaining <= 0) {
      this.truncated = true;
    } else {
      const accepted = truncateUtf8(output.data, remaining);
      this.buffer += accepted;
      this.bufferBytes += Buffer.byteLength(accepted, 'utf8');
      if (accepted.length !== output.data.length) this.truncated = true;
    }
    this.scheduleFlush();
  }

  close(flush = true): void {
    if (this.closed) return;
    this.closed = true;
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
    if (flush) this.flush();
    else this.reset();
  }

  private scheduleFlush(): void {
    if (this.timer !== undefined) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.flush();
    }, DESKTOP_RUNTIME_LIMITS.terminalOutputFlushIntervalMs);
  }

  private flush(): void {
    if (this.buffer.length === 0 && !this.truncated) return;
    const data = `${this.buffer}${this.truncated ? '\r\n[terminal output truncated]\r\n' : ''}`;
    this.reset();
    if (this.sender.isDestroyed()) return;
    try { this.sender.send('terminal.output', { sessionId: this.sessionId, data }); }
    catch { /* Renderer teardown can race the final PTY flush. */ }
  }

  private reset(): void {
    this.buffer = '';
    this.bufferBytes = 0;
    this.truncated = false;
  }
}

export function createTerminalOutputDispatcher(sender: TerminalOutputSender, sessionId: string): TerminalOutputDispatcher {
  const dispatcher = new TerminalOutputDispatcher({
    isDestroyed: () => sender.isDestroyed(),
    send: (channel, output) => sender.send(channel, output),
  }, sessionId);
  return dispatcher;
}

function truncateUtf8(value: string, maxBytes: number): string {
  if (Buffer.byteLength(value, 'utf8') <= maxBytes) return value;
  let result = '';
  for (const character of value) {
    if (Buffer.byteLength(result + character, 'utf8') > maxBytes) break;
    result += character;
  }
  return result;
}
