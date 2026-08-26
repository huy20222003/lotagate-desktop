import { executeDesktopCommand, listDesktopCommands, type DesktopCommandInvocation } from '../../services/desktop-command-client.js';

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
    const output = await this.execute(cwd, { actionId: LIST_ACTIONS[kind], positionals: [], options: {} });
    const rows = parseExtensionRows(output, kind);
    if (kind !== 'hook') return rows;
    const projectHooks = new Set(await window.lotagate.extensions.listProjectHooks(cwd));
    return rows.map(row => ({ ...row, editable: projectHooks.has(row.name) }));
  }

  async execute(cwd: string, invocation: CommandInvocation): Promise<string> {
    return executeDesktopCommand(cwd, invocation);
  }
}

export function parseExtensionRows(output: string, kind: ExtensionKind): ExtensionRow[] {
  return output.split(/\r?\n/u).flatMap(line => {
    if (!line.trim() || /^Name\s{2,}Status\s{2,}Detail$/u.test(line.trim()) || /^No /u.test(line.trim())) return [];
    const match = /^(.*?)\s{2,}(\S+)\s{2,}(.*)$/u.exec(line.trimEnd());
    if (!match) return [];
    const name = match[1]?.trim();
    const status = match[2]?.trim();
    const detail = match[3]?.trim();
    if (!name || !status || detail === undefined) return [];
    const scope = kind === 'hook' ? undefined : readScope(detail);
    return [{ name, status, detail, ...(scope === undefined ? {} : { scope }) }];
  });
}

function readScope(detail: string): ExtensionScope | undefined { const scope = detail.split(' · ', 1)[0]; return scope === 'user' || scope === 'project' || scope === 'builtin' ? scope : undefined; }
