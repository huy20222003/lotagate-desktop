import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { terminalSessionOpenSchema, terminalSessionIdSchema, terminalSessionResizeSchema, terminalSessionWriteSchema, type TerminalSession, type TerminalSessionOutput } from '../../contracts/ipc/v1/workspace.js';
import type { WorkspaceRegistry } from '../workspaces/workspace-registry.js';
import { SettingsService } from '../settings/settings-service.js';
import { resolveTerminalShell } from './terminal-shell.js';
import { MAX_INPUT_BYTES } from './terminal-constants.js';
import { createChildProcessEnvironment } from '../process/process-environment.js';
// The interactive terminal is an explicit user action. Agent-run commands
// continue to use TerminalService's trusted-workspace and approval gates.

type NodePtyModule = typeof import('node-pty');
type IPty = import('node-pty').IPty;

let cachedNodePty: NodePtyModule | undefined;

function getNodePty(): NodePtyModule {
  if (cachedNodePty !== undefined) return cachedNodePty;
  try {
    cachedNodePty = loadNodePty();
    return cachedNodePty;
  } catch (error) {
    throw new Error('Interactive terminal is unavailable: native terminal module could not be loaded.', { cause: error });
  }
}

interface InteractiveSession {
  ownerId: number;
  cwd: string;
  child: IPty;
}

export class InteractiveTerminalService {
  private readonly sessions = new Map<string, InteractiveSession>();

  constructor(private readonly workspaces: WorkspaceRegistry, private readonly settings: SettingsService) {}

  async open(input: unknown, ownerId: number, onOutput: (output: TerminalSessionOutput) => void): Promise<TerminalSession> {
    const value = terminalSessionOpenSchema.parse(input);
    const cwd = await this.workspaces.requireRegisteredRoot(value.cwd);

    const launch = resolveTerminalShell((await this.settings.get()).terminalShell);
    const nodePty = getNodePty();
    const child = nodePty.spawn(launch.command, launch.args, { cwd, name: 'xterm-256color', cols: 120, rows: 30, env: createChildProcessEnvironment({ overrides: { FORCE_COLOR: '1', TERM: 'xterm-256color', COLORTERM: 'truecolor' } }) });
    const id = randomUUID();
    this.sessions.set(id, { ownerId, cwd, child });
    child.onData(data => onOutput({ sessionId: id, data }));
    child.onExit(() => this.sessions.delete(id));
    return { id, cwd, shell: launch.command };
  }

  write(sessionId: string, data: string, ownerId: number): void {
    const id = terminalSessionIdSchema.parse(sessionId);
    const value = terminalSessionWriteSchema.parse({ sessionId: id, data });
    const session = this.requireOwned(id, ownerId);
    if (Buffer.byteLength(value.data, 'utf8') > MAX_INPUT_BYTES) throw new Error('Terminal input is too large.');
    session.child.write(value.data);
  }

  resize(sessionId: string, cols: number, rows: number, ownerId: number): void {
    const value = terminalSessionResizeSchema.parse({ sessionId, cols, rows });
    const session = this.requireOwned(value.sessionId, ownerId);
    session.child.resize(value.cols, value.rows);
  }

  close(sessionId: string, ownerId: number): void {
    const id = terminalSessionIdSchema.parse(sessionId);
    const session = this.requireOwned(id, ownerId);
    this.sessions.delete(id);
    session.child.kill();
  }

  closeOwner(ownerId: number): void {
    for (const [id, session] of this.sessions) if (session.ownerId === ownerId) {
      this.sessions.delete(id);
      session.child.kill();
    }
  }

  private requireOwned(id: string, ownerId: number): InteractiveSession {
    const session = this.sessions.get(id);
    if (!session || session.ownerId !== ownerId) throw new Error('Terminal session was not found.');
    return session;
  }
}

function loadNodePty(): NodePtyModule {
  const requireModule = createRequire(__filename);
  const packagedEntry = typeof process.resourcesPath === 'string'
    ? join(process.resourcesPath, 'node-pty', 'lib', 'index.js')
    : undefined;

  if (packagedEntry !== undefined && existsSync(packagedEntry)) {
    return requireModule(packagedEntry) as NodePtyModule;
  }

  return requireModule('node-pty') as NodePtyModule;
}
