import { executeDesktopCommand, executeDesktopCommandResult, listDesktopCommands, type DesktopCommandInvocation } from './desktop-command-client.js';

export type ExtensionKind = 'hook' | 'skill' | 'plugin' | 'mcp';
export type ExtensionScope = 'user' | 'project' | 'plugin' | 'builtin';

export interface ExtensionRow {
  name: string;
  status: string;
  detail: string;
  description?: string;
  version?: string;
  scope?: ExtensionScope;
  pluginName?: string;
  pluginScope?: 'user' | 'project';
  sourceName?: string;
  editable?: boolean;
}

export type PluginContributionKind = 'skill' | 'mcp' | 'hook' | 'agent';
export interface PluginContribution {
  kind: PluginContributionKind;
  name: string;
  sourceName: string;
  description: string;
  status: 'ENABLED' | 'DISABLED';
}
export interface PluginDetail {
  plugin: {
    name: string;
    version: string;
    description?: string;
    author?: string;
    license?: string;
    homepage?: string;
    repository?: string;
    keywords?: string[];
    scope: 'user' | 'project';
    status: 'ENABLED' | 'DISABLED';
  };
  contributions: PluginContribution[];
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

  async detail(cwd: string, name: string, scope: 'user' | 'project'): Promise<PluginDetail> {
    const result = await executeDesktopCommandResult(cwd, { actionId: 'plugin.info', positionals: [name], options: { scope } });
    return parsePluginDetail(result.structured);
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
    if (kind === 'hook') return [{ name, status, detail, ...readListMetadata(row), ...readContributionOwner(row) }];
    const scope = readScope(row['scope']);
    return scope === undefined ? [] : [{ name, status, detail, scope, ...readListMetadata(row), ...readContributionOwner(row) }];
  });
}

function readListMetadata(row: Record<string, unknown>): Pick<ExtensionRow, 'description' | 'version'> {
  const description = typeof row['description'] === 'string' ? row['description'] : undefined;
  const version = typeof row['version'] === 'string' ? row['version'] : undefined;
  return { ...(description === undefined ? {} : { description }), ...(version === undefined ? {} : { version }) };
}

function readScope(value: unknown): ExtensionScope | undefined { return value === 'user' || value === 'project' || value === 'plugin' || value === 'builtin' ? value : undefined; }
function readContributionOwner(row: Record<string, unknown>): Pick<ExtensionRow, 'pluginName' | 'sourceName'> {
  const pluginName = typeof row['pluginName'] === 'string' ? row['pluginName'] : undefined;
  const sourceName = typeof row['sourceName'] === 'string' ? row['sourceName'] : undefined;
  return { ...(pluginName === undefined ? {} : { pluginName }), ...(sourceName === undefined ? {} : { sourceName }) };
}

function parsePluginDetail(value: Record<string, unknown> | undefined): PluginDetail {
  if (value === undefined || value['kind'] !== 'plugin' || !isRecord(value['plugin']) || !Array.isArray(value['contributions'])) throw new Error('The CLI returned an invalid plugin detail.');
  const plugin = value['plugin'];
  const name = readRequiredString(plugin['name']);
  const version = readRequiredString(plugin['version']);
  const scope = plugin['scope'];
  const status = plugin['status'];
  if (scope !== 'user' && scope !== 'project') throw new Error('The CLI returned an invalid plugin scope.');
  if (status !== 'ENABLED' && status !== 'DISABLED') throw new Error('The CLI returned an invalid plugin status.');
  const contributions = value['contributions'].flatMap(item => parseContribution(item));
  return { plugin: { name, version, scope, status, ...readOptionalPluginMetadata(plugin) }, contributions };
}

function parseContribution(value: unknown): PluginContribution[] {
  if (!isRecord(value) || (value['kind'] !== 'skill' && value['kind'] !== 'mcp' && value['kind'] !== 'hook' && value['kind'] !== 'agent')) return [];
  const name = value['name']; const sourceName = value['sourceName']; const description = value['description']; const status = value['status'];
  return typeof name === 'string' && typeof sourceName === 'string' && typeof description === 'string' && (status === 'ENABLED' || status === 'DISABLED') ? [{ kind: value['kind'], name, sourceName, description, status }] : [];
}

function readOptionalPluginMetadata(value: Record<string, unknown>): Pick<PluginDetail['plugin'], 'description' | 'author' | 'license' | 'homepage' | 'repository' | 'keywords'> {
  const optional = ['description', 'author', 'license', 'homepage', 'repository'].reduce<Record<string, string>>((result, key) => { if (typeof value[key] === 'string') result[key] = value[key] as string; return result; }, {});
  const keywords = Array.isArray(value['keywords']) && value['keywords'].every(item => typeof item === 'string') ? value['keywords'] as string[] : undefined;
  return { ...optional, ...(keywords === undefined ? {} : { keywords }) } as Pick<PluginDetail['plugin'], 'description' | 'author' | 'license' | 'homepage' | 'repository' | 'keywords'>;
}

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function readRequiredString(value: unknown): string { if (typeof value !== 'string' || value.length === 0) throw new Error('The CLI returned an invalid plugin detail.'); return value; }
