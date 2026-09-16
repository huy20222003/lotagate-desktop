import { StringDecoder } from 'node:string_decoder';

export type OutputChannel = 'stdout' | 'stderr';

export interface BoundedOutputValue {
  stdout: string;
  stderr: string;
  truncated: boolean;
}

/** Collects process output with one UTF-8 byte budget shared by stdout and stderr. */
export class BoundedOutputCollector {
  private readonly decoders = { stdout: new StringDecoder('utf8'), stderr: new StringDecoder('utf8') };
  private stdout = '';
  private stderr = '';
  private bytes = 0;
  private truncated = false;

  constructor(private readonly maxBytes: number) {}

  append(channel: OutputChannel, chunk: Buffer | string): void {
    if (this.truncated) return;
    const text = typeof chunk === 'string' ? chunk : this.decoders[channel].write(chunk);
    this.appendText(channel, text);
  }

  finish(): void {
    if (this.truncated) return;
    this.appendText('stdout', this.decoders.stdout.end());
    this.appendText('stderr', this.decoders.stderr.end());
  }

  value(): BoundedOutputValue {
    return { stdout: this.stdout, stderr: this.stderr, truncated: this.truncated };
  }

  private appendText(channel: OutputChannel, value: string): void {
    if (value.length === 0 || this.truncated) return;
    const remaining = this.maxBytes - this.bytes;
    if (remaining <= 0) {
      this.truncated = true;
      return;
    }
    const accepted = truncateUtf8(value, remaining);
    this.bytes += Buffer.byteLength(accepted, 'utf8');
    if (channel === 'stdout') this.stdout += accepted;
    else this.stderr += accepted;
    if (accepted.length !== value.length) this.truncated = true;
  }
}

function truncateUtf8(value: string, maxBytes: number): string {
  if (Buffer.byteLength(value, 'utf8') <= maxBytes) return value;
  let end = Math.min(value.length, maxBytes);
  while (end > 0 && Buffer.byteLength(value.slice(0, end), 'utf8') > maxBytes) end -= 1;
  return value.slice(0, end);
}
