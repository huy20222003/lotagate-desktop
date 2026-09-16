import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { terminalExecutionInputSchema, type TerminalExecutionInput } from '../../contracts/ipc/v1/workspace.js';
import { isReadOnlyCommand } from '../../contracts/command-policy.js';
import type { TaskStore } from '../tasks/task-store.js';
import type { WorkspaceRegistry } from '../workspaces/workspace-registry.js';
import { assertPathInside, requireDirectory } from '../security/path-policy.js';
import { JsonFileStore } from '../persistence/json-file-store.js';
import { desktopDataPath } from '../persistence/app-data-paths.js';
import { terminateDesktopProcess } from '../process/process-termination.js';
import { createChildProcessEnvironment } from '../process/process-environment.js';
import { BoundedOutputCollector } from '../process/bounded-output.js';
import { MAX_EVIDENCE_BYTES, MAX_EVIDENCE_RECORDS, MAX_OUTPUT_BYTES } from './terminal-constants.js';

export interface TerminalResult { command: string; args: string[]; cwd: string; stdout: string; stderr: string; exitCode: number | null; truncated: boolean; durationMs: number; }
export interface TerminalEvidence extends TerminalResult { id: string; taskId?: string | undefined; createdAt: string; }
const terminalEvidenceSchema = z.object({ id: z.string().min(1), taskId: z.string().min(1).optional(), command: z.string().min(1), args: z.array(z.string()), cwd: z.string().min(1), stdout: z.string(), stderr: z.string(), exitCode: z.number().int().nullable(), truncated: z.boolean(), durationMs: z.number().nonnegative(), createdAt: z.string().datetime() });
const terminalEvidenceSchemaArray = terminalEvidenceSchema.array();

interface EvidenceStore {
  read(): Promise<TerminalEvidence[]>;
  write(value: TerminalEvidence[]): Promise<void>;
  update(mutator: (current: TerminalEvidence[]) => TerminalEvidence[] | Promise<TerminalEvidence[]>): Promise<TerminalEvidence[]>;
}

export class TerminalService {
  private readonly evidence: EvidenceStore;

  constructor(private readonly workspaces: WorkspaceRegistry, private readonly tasks: TaskStore, evidence: EvidenceStore = new JsonFileStore<TerminalEvidence[]>(desktopDataPath('terminal-evidence.json'), [], value => terminalEvidenceSchemaArray.parse(value)), private readonly getRetentionDays: () => Promise<number> = async () => 30) {
    this.evidence = evidence;
  }

  async execute(input: TerminalExecutionInput): Promise<TerminalEvidence> {
    const value = terminalExecutionInputSchema.parse(input);
    const task = await this.tasks.require(value.taskId);
    const workspace = await this.workspaces.require(task.workspaceId);
    if (!workspace.trusted) throw new Error('Terminal execution requires a trusted workspace.');
    const cwd = await requireDirectory(value.cwd);
    assertPathInside(cwd, workspace.rootPath);
    if (!value.approved && !isReadOnlyCommand(value.command, value.args)) throw new Error('This command requires explicit approval.');
    const started = Date.now();
    const child = spawn(value.command, value.args, { cwd, shell: false, detached: process.platform !== 'win32', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: createChildProcessEnvironment() });
    const output = new BoundedOutputCollector(MAX_OUTPUT_BYTES);
    child.stdout.on('data', chunk => output.append('stdout', chunk));
    child.stderr.on('data', chunk => output.append('stderr', chunk));
    let termination: Promise<void> | undefined;
    const timeout = value.timeoutMs === undefined ? undefined : setTimeout(() => { termination = terminateDesktopProcess(child); }, value.timeoutMs);
    const exitCode = await new Promise<number | null>((resolve, reject) => { child.on('error', reject); child.on('close', code => resolve(code)); });
    if (timeout !== undefined) clearTimeout(timeout);
    if (termination !== undefined) await termination;
    output.finish();
    const captured = output.value();
    const result: TerminalEvidence = { id: randomUUID(), taskId: value.taskId, command: value.command, args: [...value.args], cwd, stdout: redact(captured.stdout), stderr: redact(captured.stderr), exitCode, truncated: captured.truncated, durationMs: Date.now() - started, createdAt: new Date().toISOString() };
    await this.evidence.update(async current => retainEvidence([...current, result], await this.getRetentionDays()));
    return result;
  }

  async list(taskId?: string): Promise<TerminalEvidence[]> { const values = await this.evidence.read(); return taskId === undefined ? values : values.filter(item => item.taskId === taskId); }
}

async function retainEvidence(values: TerminalEvidence[], retentionDays: number): Promise<TerminalEvidence[]> {
  const boundedDays = Math.max(1, Math.min(365, Math.floor(retentionDays)));
  const cutoff = Date.now() - boundedDays * 24 * 60 * 60 * 1_000;
  const recent = values.filter(value => Date.parse(value.createdAt) >= cutoff).slice(-MAX_EVIDENCE_RECORDS);
  const retained: TerminalEvidence[] = [];
  let bytes = 0;
  for (const value of [...recent].reverse()) {
    const size = Buffer.byteLength(JSON.stringify(value), 'utf8');
    if (retained.length > 0 && bytes + size > MAX_EVIDENCE_BYTES) break;
    retained.unshift(value);
    bytes += size;
  }
  return retained;
}

function redact(value: string): string { return value.replace(/Bearer\s+[^\s]+/giu, 'Bearer [REDACTED]').replace(/sk-[A-Za-z0-9_-]{8,}/gu, '[REDACTED]'); }
