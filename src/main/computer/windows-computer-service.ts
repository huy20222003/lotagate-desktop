import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { isComputerApplicationAllowed, normalizeComputerApplicationAllowlist } from '../../contracts/ipc/v1/computer-application-allowlist.js';

const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 30_000;

/** Executes the fixed, allowlisted Windows Computer Use contract through the bundled PowerShell adapter. */
export class WindowsComputerService {
  constructor(private readonly scriptPath: string, private readonly timeoutMs = DEFAULT_TIMEOUT_MS, private readonly getApplicationAllowlist: () => readonly string[] | Promise<readonly string[]> = async () => []) {}

  async execute(action: string, params: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
    if (process.platform !== 'win32') throw new Error('Computer Use is available only on Windows.');
    await readFile(this.scriptPath, 'utf8');
    const allowedApplications = action === 'computer.launch' ? normalizeComputerApplicationAllowlist(await this.getApplicationAllowlist()) : undefined;
    if (action === 'computer.launch') {
      const appId = typeof params['appId'] === 'string' ? params['appId'] : '';
      if (!isComputerApplicationAllowed(appId, allowedApplications ?? [])) throw new Error(`Application '${appId || 'unknown'}' is not allowlisted.`);
    }
    return new Promise((resolve, reject) => {
      const child = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', this.scriptPath], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      let bytes = 0;
      let settled = false;
      const finish = (error?: Error, value?: unknown): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        if (error !== undefined) reject(error); else resolve(value);
      };
      const abort = (): void => { child.kill(); finish(new Error('Computer action was cancelled.')); };
      const timer = setTimeout(() => { child.kill(); finish(new Error('Computer action timed out.')); }, this.timeoutMs);
      child.stdout.on('data', chunk => {
        if (settled) return;
        const text = chunk.toString('utf8');
        bytes += Buffer.byteLength(text, 'utf8');
        if (bytes > MAX_RESPONSE_BYTES) { child.kill(); finish(new Error('Computer response exceeded the configured size limit.')); return; }
        stdout += text;
      });
      child.stderr.on('data', chunk => { stderr += chunk.toString('utf8').slice(0, 16_384); });
      child.once('error', error => finish(error));
      child.once('close', code => {
        if (settled) return;
        if (code !== 0) { finish(new Error(stderr.trim() || `Computer adapter exited with code ${String(code)}.`)); return; }
        try {
          const parsed: unknown = JSON.parse(stdout);
          if (!isRecord(parsed) || parsed['ok'] !== true) throw new Error(isRecord(parsed) && typeof parsed['error'] === 'string' ? parsed['error'] : 'Computer adapter returned an invalid response.');
          finish(undefined, parsed['result']);
        } catch (error) { finish(error instanceof Error ? error : new Error('Computer adapter returned invalid JSON.')); }
      });
      if (signal?.aborted) { abort(); return; }
      signal?.addEventListener('abort', abort, { once: true });
      child.stdin.end(JSON.stringify({ action, params, ...(allowedApplications === undefined ? {} : { allowedApplications }) }));
    });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
