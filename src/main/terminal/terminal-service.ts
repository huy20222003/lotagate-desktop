import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { requireDirectory } from '../security/path-policy.js';
import { JsonFileStore } from '../persistence/json-file-store.js';
import { desktopDataPath } from '../persistence/app-data-paths.js';

const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;

export interface TerminalResult { command: string; args: string[]; cwd: string; stdout: string; stderr: string; exitCode: number | null; truncated: boolean; durationMs: number; }
export interface TerminalEvidence extends TerminalResult { id: string; taskId?: string; createdAt: string; }

export class TerminalService {
  private readonly evidence = new JsonFileStore<TerminalEvidence[]>(desktopDataPath('terminal-evidence.json'), []);

  async execute(input: { cwd: string; command: string; args: string[]; timeoutMs?: number; taskId?: string }): Promise<TerminalEvidence> {
    const cwd = await requireDirectory(input.cwd);
    const started = Date.now();
    const child = spawn(input.command, input.args, { cwd, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: safeEnvironment() });
    let stdout = ''; let stderr = ''; let truncated = false;
    const collect = (chunk: Buffer, target: 'stdout' | 'stderr') => {
      const available = MAX_OUTPUT_BYTES - Buffer.byteLength(stdout + stderr, 'utf8');
      if (available <= 0) { truncated = true; return; }
      const value = chunk.toString('utf8');
      const text = Buffer.byteLength(value, 'utf8') <= available ? value : value.slice(0, available);
      if (text.length !== value.length) truncated = true;
      if (target === 'stdout') stdout += text; else stderr += text;
    };
    child.stdout.on('data', chunk => collect(chunk, 'stdout'));
    child.stderr.on('data', chunk => collect(chunk, 'stderr'));
    const timeout = input.timeoutMs === undefined ? undefined : setTimeout(() => child.kill(), input.timeoutMs);
    const exitCode = await new Promise<number | null>((resolve, reject) => { child.on('error', reject); child.on('close', code => resolve(code)); });
    if (timeout !== undefined) clearTimeout(timeout);
    const result: TerminalEvidence = { id: randomUUID(), ...(input.taskId === undefined ? {} : { taskId: input.taskId }), command: input.command, args: [...input.args], cwd, stdout: redact(stdout), stderr: redact(stderr), exitCode, truncated, durationMs: Date.now() - started, createdAt: new Date().toISOString() };
    await this.evidence.write([...(await this.evidence.read()), result]);
    return result;
  }

  async list(taskId?: string): Promise<TerminalEvidence[]> { const values = await this.evidence.read(); return taskId === undefined ? values : values.filter(item => item.taskId === taskId); }
}

function safeEnvironment(): NodeJS.ProcessEnv { const allowed = ['PATH', 'Path', 'PATHEXT', 'SystemRoot', 'TEMP', 'TMP', 'HOME', 'USERPROFILE', 'LANG', 'LC_ALL']; return Object.fromEntries(allowed.flatMap(key => process.env[key] === undefined ? [] : [[key, process.env[key] as string]])); }
function redact(value: string): string { return value.replace(/Bearer\s+[^\s]+/giu, 'Bearer [REDACTED]').replace(/sk-[A-Za-z0-9_-]{8,}/gu, '[REDACTED]'); }
