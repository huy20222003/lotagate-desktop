import { readFile } from 'node:fs/promises';
import { isComputerApplicationAllowed, normalizeComputerApplicationAllowlist } from '../../contracts/ipc/v1/computer-application-allowlist.js';
import { COMPUTER_ACTION_TIMEOUT_MS, MAX_RESPONSE_BYTES } from './computer-constants.js';
import type { DesktopHostCapability } from '../../contracts/agent-protocol/v1/host-capabilities.js';
import type { ComputerRuntime } from './computer-runtime.js';
import { runBoundedCommand } from '../process/bounded-command.js';
import { COMPUTER_HOST_OPERATIONS } from '../host/host-operation-catalog.js';

export { COMPUTER_ACTION_TIMEOUT_MS } from './computer-constants.js';

/** Executes the fixed, allowlisted Windows Computer Use contract through the bundled PowerShell adapter. */
export class WindowsComputerService implements ComputerRuntime {
  readonly capabilities: DesktopHostCapability = { available: true, provider: 'windows-powershell-ui-automation', operations: COMPUTER_HOST_OPERATIONS };

  constructor(private readonly scriptPath: string, private readonly timeoutMs = COMPUTER_ACTION_TIMEOUT_MS, private readonly getApplicationAllowlist: () => readonly string[] | Promise<readonly string[]> = async () => []) {}

  async execute(action: string, params: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
    if (process.platform !== 'win32') throw new Error('Computer Use is available only on Windows.');
    await readFile(this.scriptPath, 'utf8');
    const allowedApplications = action === 'computer.launch' ? normalizeComputerApplicationAllowlist(await this.getApplicationAllowlist()) : undefined;
    if (action === 'computer.launch') {
      const appId = typeof params['appId'] === 'string' ? params['appId'] : '';
      if (!isComputerApplicationAllowed(appId, allowedApplications ?? [])) throw new Error(`Application '${appId || 'unknown'}' is not allowlisted.`);
    }
    const result = await runBoundedCommand('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'Bypass', '-File', this.scriptPath], {
      input: JSON.stringify({ action, params, ...(allowedApplications === undefined ? {} : { allowedApplications }) }),
      maxOutputBytes: MAX_RESPONSE_BYTES,
      timeoutMs: this.timeoutMs,
      ...(signal === undefined ? {} : { signal }),
    });
    let parsed: unknown;
    try { parsed = JSON.parse(result.stdout.toString('utf8')); }
    catch { throw new Error('Computer adapter returned invalid JSON.'); }
    if (isRecord(parsed) && parsed['ok'] === false) throw new Error(typeof parsed['error'] === 'string' ? parsed['error'] : 'Computer adapter rejected the action.');
    if (!isRecord(parsed) || parsed['ok'] !== true) throw new Error('Computer adapter returned an invalid response.');
    return parsed['result'];
  }
}

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
