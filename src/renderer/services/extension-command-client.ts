import { executeDesktopCommand, executeDesktopCommandResult, listDesktopCommands, type DesktopCommandInvocation } from './desktop-command-client.js';

export type ExtensionKind = 'hook' | 'skill' | 'plugin' | 'mcp';
export type ExtensionScope = 'user' | 'project' | 'builtin';

export interface ExtensionRow {
  name: string;
  status: string;
  detail: string;
  scope?: ExtensionScope;
  editable?: boolean;
}

export type CommandInvocation = DesktopCommandInvocation;

const LIST_ACTIONS: Record<ExtensionKind, string> = { hook: 'hook.list', skill: 'skill.list', plugin: 'plugin.list', mcp: 'mcp.list' };

export class ExtensionCommandClient {
  async listCommands(cwd: string): Promise<Set<string>> {
    return new Set((await listDesktopCommands(cwd)).map(command => command.id));
  }

  async list(cwd: string, kind: ExtensionKind): Promise<ExtensionRow[]> {
    const result = await executeDesktopCommandResult(cwd, { actionId: LIST_ACTIONS[kind], positionals: [], options: {} });
    const rows = parseExtensionRows(result.structured, kind);
    if (kind !== 'hook') return rows;
    const projectHooks = new Set(await window.lotagate.extensions.listProjectHooks(cwd));
    return rows.map(row => ({ ...row, editable: projectHooks.has(row.name) }));
  }

  async execute(cwd: string, invocation: CommandInvocation): Promise<string> {
    return executeDesktopCommand(cwd, invocation);
  }
}

export function parseExtensionRows(value: unknown, kind: ExtensionKind): ExtensionRow[] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return [];
  const payload = value as Record<string, unknown>;
  if (payload['kind'] !== kind || !Array.isArray(payload['items'])) return [];
  return payload['items'].flatMap(item => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) return [];
    const row = item as Record<string, unknown>;
    const name = row['name'];
    const status = row['status'];
    const detail = row['detail'];
    if (typeof name !== 'string' || name.length === 0 || typeof status !== 'string' || status.length === 0 || typeof detail !== 'string') return [];
    if (kind === 'hook') return [{ name, status, detail }];
    const scope = readScope(row['scope']);
    return scope === undefined ? [] : [{ name, status, detail, scope }];
  });
}

function readScope(value: unknown): ExtensionScope | undefined { return value === 'user' || value === 'project' || value === 'builtin' ? value : undefined; }
