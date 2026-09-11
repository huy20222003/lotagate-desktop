import { spawn } from 'node:child_process';
import { terminateDesktopProcess } from './process-termination.js';

export interface BoundedCommandOptions {
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly input?: string | Buffer;
  readonly maxOutputBytes: number;
  readonly timeoutMs: number;
  readonly signal?: AbortSignal;
}

export interface BoundedCommandResult {
  readonly stdout: Buffer;
  readonly stderr: string;
  readonly exitCode: number;
}

/** Runs a native helper without a shell and with one bounded cancellation path. */
export function runBoundedCommand(command: string, args: readonly string[], options: BoundedCommandOptions): Promise<BoundedCommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...args], {
      ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
      ...(options.env === undefined ? {} : { env: options.env }),
      shell: false,
      windowsHide: true,
      detached: process.platform !== 'win32',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const stdout: Buffer[] = [];
    let stderr = '';
    let outputBytes = 0;
    let settled = false;
    let stopping = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const cleanup = (): void => {
      if (timer !== undefined) clearTimeout(timer);
      options.signal?.removeEventListener('abort', abort);
    };
    const finish = (error?: Error, result?: BoundedCommandResult): void => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error === undefined && result !== undefined) resolve(result); else reject(error ?? new Error('Native command failed.'));
    };
    const stop = (error: Error): void => {
      if (stopping || settled) return;
      stopping = true;
      void terminateDesktopProcess(child).then(() => finish(error), terminationError => finish(new Error(`${error.message} ${terminationError instanceof Error ? terminationError.message : 'Native process termination could not be confirmed.'}`)));
    };
    const abort = (): void => stop(new Error('Native command was cancelled.'));
    const append = (chunk: Buffer, target: 'stdout' | 'stderr'): void => {
      if (settled || stopping) return;
      outputBytes += chunk.byteLength;
      if (outputBytes > options.maxOutputBytes) { stop(new Error('Native command output exceeded the configured limit.')); return; }
      if (target === 'stdout') stdout.push(chunk); else stderr += chunk.toString('utf8');
    };

    timer = setTimeout(() => stop(new Error(`Native command timed out after ${String(options.timeoutMs)}ms.`)), options.timeoutMs);
    child.stdout.on('data', chunk => append(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk), 'stdout'));
    child.stderr.on('data', chunk => append(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk), 'stderr'));
    child.once('error', error => { if (!stopping) finish(error); });
    child.once('close', code => {
      if (settled || stopping) return;
      const exitCode = code ?? -1;
      if (exitCode !== 0) { finish(new Error(stderr.trim() || `Native command exited with code ${String(exitCode)}.`)); return; }
      finish(undefined, { stdout: Buffer.concat(stdout), stderr, exitCode });
    });
    if (options.signal?.aborted === true) { abort(); return; }
    options.signal?.addEventListener('abort', abort, { once: true });
    if (options.input === undefined) child.stdin.end(); else child.stdin.end(options.input);
  });
}
