import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { isComputerApplicationAllowed, normalizeComputerApplicationAllowlist } from '../../contracts/ipc/v1/computer-application-allowlist.js';
import { terminateDesktopProcess } from '../process/process-termination.js';

const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
export const COMPUTER_ACTION_TIMEOUT_MS = 120_000;

/** Executes the fixed, allowlisted Windows Computer Use contract through the bundled PowerShell adapter. */
export class WindowsComputerService {
  constructor(private readonly scriptPath: string, private readonly timeoutMs = COMPUTER_ACTION_TIMEOUT_MS, private readonly getApplicationAllowlist: () => readonly string[] | Promise<readonly string[]> = async () => []) {}

  async execute(action: string, params: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
    if (process.platform !== 'win32') throw new Error('Computer Use is available only on Windows.');
    await readFile(this.scriptPath, 'utf8');
    const allowedApplications = action === 'computer.launch' ? normalizeComputerApplicationAllowlist(await this.getApplicationAllowlist()) : undefined;
    if (action === 'computer.launch') {
      const appId = typeof params['appId'] === 'string' ? params['appId'] : '';
      if (!isComputerApplicationAllowed(appId, allowedApplications ?? [])) throw new Error(`Application '${appId || 'unknown'}' is not allowlisted.`);
    }
    return new Promise((resolve, reject) => {
      const child = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', this.scriptPath], { windowsHide: true, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      let bytes = 0;
      let settled = false;
      let stopping = false;
      let stopError: Error | undefined;
      const finish = (error?: Error, value?: unknown): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        if (error !== undefined) reject(error); else resolve(value);
      };
      const stop = (error: Error): void => {
        if (stopping || settled) return;
        stopping = true;
        stopError = error;
        void terminateDesktopProcess(child).then(() => finish(stopError), terminationError => finish(new Error(`${error.message} ${terminationError instanceof Error ? terminationError.message : 'Process termination could not be confirmed.'}`)));
      };
      const abort = (): void => stop(new Error('Computer action was cancelled.'));
      const timer = setTimeout(() => stop(new Error('Computer action timed out.')), this.timeoutMs);
      child.stdout.on('data', chunk => {
        if (settled) return;
        const text = chunk.toString('utf8');
        bytes += Buffer.byteLength(text, 'utf8');
        if (bytes > MAX_RESPONSE_BYTES) { stop(new Error('Computer response exceeded the configured size limit.')); return; }
        stdout += text;
      });
      child.stderr.on('data', chunk => { stderr += chunk.toString('utf8').slice(0, 16_384); });
      child.once('error', error => { if (!stopping) finish(error); });
      child.once('close', code => {
        if (settled) return;
        if (stopping) return;
        try {
          const parsed: unknown = JSON.parse(stdout);
          if (isRecord(parsed) && parsed['ok'] === false) throw new Error(typeof parsed['error'] === 'string' ? parsed['error'] : 'Computer adapter rejected the action.');
          if (code !== 0) throw new Error(stderr.trim() || `Computer adapter exited with code ${String(code)}.`);
          if (!isRecord(parsed) || parsed['ok'] !== true) throw new Error('Computer adapter returned an invalid response.');
          finish(undefined, parsed['result']);
        } catch (error) {
          if (error instanceof SyntaxError && code !== 0) finish(new Error(stderr.trim() || `Computer adapter exited with code ${String(code)}.`));
          else finish(error instanceof Error ? error : new Error('Computer adapter returned invalid JSON.'));
        }
      });
      if (signal?.aborted) { abort(); return; }
      signal?.addEventListener('abort', abort, { once: true });
      child.stdin.end(JSON.stringify({ action, params, ...(allowedApplications === undefined ? {} : { allowedApplications }) }));
    });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
