import { existsSync } from 'node:fs';
import { lstat, mkdir, readdir, readFile, realpath, unlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { discoverHooks } from '@lotagate/cli/dist/infrastructure/extensions/hook-runtime.js';
import { loadPluginMcpConfig } from '@lotagate/cli/dist/application/extensions/plugin-contribution-registry.js';
import { PluginAgentDiscovery } from '@lotagate/cli/dist/infrastructure/extensions/plugin-agent-discovery.js';
import { PluginDiscovery } from '@lotagate/cli/dist/infrastructure/extensions/plugin-discovery.js';
import { PLUGIN_LAYOUT } from '@lotagate/cli/dist/domain/extensions/plugin-manifest.js';
import { SkillDiscovery } from '@lotagate/cli/dist/infrastructure/extensions/skill-discovery.js';
import type { ExtensionDetail, ExtensionDetailInput, ExtensionDetailWriteInput, HookCreateInput, PublicPluginCatalogEntry, PublicPluginContributionInput } from '../../contracts/ipc/v1/extensions.js';
import { requireDirectory } from '../security/path-policy.js';
import { ensureProjectConfig, resolveProjectConfigPaths } from '../workspaces/project-config-layout.js';

const MAX_DETAIL_BYTES = 2 * 1024 * 1024;
const MAX_PLUGIN_ICON_BYTES = 256 * 1024;
const require = createRequire(import.meta.url);

export class ExtensionFileService {
  constructor(private readonly workspaceTrust?: WorkspaceTrust, private readonly publicPluginRoot?: string) {}

  async listPublicPlugins(): Promise<readonly PublicPluginCatalogEntry[]> {
    if (this.publicPluginRoot === undefined) return [];
    const root = await realpath(this.publicPluginRoot);
    const manifests = await new PluginDiscovery().discover([root]);
    return Promise.all(manifests.map(async manifest => {
      const icon = await this.readSvgIcon(manifest.directory);
      const skills = await new SkillDiscovery().discover([join(manifest.directory, PLUGIN_LAYOUT.skillsDirectory)]);
      const mcp = await loadPluginMcpConfig([manifest]);
      const hooks = await discoverHooks(join(manifest.directory, PLUGIN_LAYOUT.hooksDirectory));
      const agents = await new PluginAgentDiscovery().discover(join(manifest.directory, PLUGIN_LAYOUT.agentsDirectory));
      const contributions = [
        ...skills.map(skill => ({ kind: 'skill' as const, sourceName: skill.name, description: skill.description })),
        ...mcp.contributions.map(contribution => ({ kind: 'mcp' as const, sourceName: contribution.sourceName, description: describePublicMcp(mcp.config[contribution.qualifiedName]?.config) })),
        ...hooks.map(hook => ({ kind: 'hook' as const, sourceName: hook.id, description: `${hook.event} hook` })),
        ...agents.map(agent => ({ kind: 'agent' as const, sourceName: agent.name, description: agent.description })),
      ].sort((left, right) => left.kind.localeCompare(right.kind) || left.sourceName.localeCompare(right.sourceName));
      return {
        directory: basename(manifest.directory),
        name: manifest.name,
        version: manifest.version,
        description: manifest.description ?? 'No description provided.',
        ...(manifest.author === undefined ? {} : { author: manifest.author }),
        ...(manifest.license === undefined ? {} : { license: manifest.license }),
        homepage: manifest.homepage ?? 'https://lotagate.com/',
        privacyPolicy: 'https://lotagate.com/privacy',
        termsOfService: 'https://lotagate.com/terms',
        ...(icon === undefined ? {} : { icon: `data:${icon.mimeType};base64,${icon.data}` }),
        contributions,
      };
    }));
  }

  async resolvePublicPluginSource(name: string): Promise<string> {
    assertSafeName(name, 'public plugin');
    if (this.publicPluginRoot === undefined) throw new Error('The public plugin catalog is not available.');
    const root = await realpath(this.publicPluginRoot);
    const candidate = resolve(root, name);
    if (!isContainedPath(root, candidate)) throw new Error('The public plugin source is outside the catalog.');
    const candidateStat = await lstat(candidate);
    if (!candidateStat.isDirectory() || candidateStat.isSymbolicLink()) throw new Error(`Public plugin source is invalid: ${name}.`);
    const canonical = await realpath(candidate);
    if (!isContainedPath(root, canonical)) throw new Error('The public plugin source is outside the catalog.');
    const manifestStat = await lstat(join(canonical, '.lotagate-plugin', 'plugin.json'));
    if (!manifestStat.isFile() || manifestStat.isSymbolicLink()) throw new Error(`Public plugin manifest is missing: ${name}.`);
    return canonical;
  }

  async listProjectHooks(cwd: string): Promise<string[]> {
    const paths = resolveProjectConfigPaths(await requireDirectory(cwd));
    const entries = await readdir(paths.hooksDir, { withFileTypes: true }).catch(() => []);
    return entries.filter(entry => entry.isFile() && /^[a-z0-9][a-z0-9-]{0,63}\.json$/u.test(entry.name)).map(entry => entry.name.slice(0, -5)).sort();
  }

  async createHook(input: HookCreateInput): Promise<{ name: string }> {
    const cwd = await this.requireTrustedProject(input.cwd);
    const paths = await ensureProjectConfig(cwd);
    assertSafeName(input.name, 'hook');
    validateHookContent(input.event, input.command, input.args, input.timeoutMs);
    const filePath = join(paths.hooksDir, `${input.name}.json`);
    await writeFile(filePath, `${JSON.stringify({ event: input.event, command: input.command.trim(), args: input.args, timeoutMs: input.timeoutMs }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    return { name: input.name };
  }

  async removeHook(input: { cwd: string; name: string }): Promise<void> {
    const cwd = await this.requireTrustedProject(input.cwd);
    assertSafeName(input.name, 'hook');
    try { await unlink(join(resolveProjectConfigPaths(cwd).hooksDir, `${input.name}.json`)); }
    catch (error) { if (!isFileNotFound(error)) throw error; }
  }

  async readDetail(input: ExtensionDetailInput): Promise<ExtensionDetail> {
    const target = await this.resolveTarget(input);
    if (target === undefined) return { content: 'This item is provided by the CLI and has no editable project file.', format: 'text', editable: false };
    const content = input.kind === 'mcp' ? await readMcpEntry(target.path, target.sourceName ?? input.name, target.directMcpEntry === true) : await readFile(target.path, { encoding: 'utf8' });
    if (Buffer.byteLength(content, 'utf8') > MAX_DETAIL_BYTES) throw new Error('The extension detail is too large to display.');
    return { content, format: target.format, editable: target.editable, ...(input.kind === 'mcp' ? {} : { fileName: basename(target.path) }) };
  }

  async readPublicPluginContribution(input: PublicPluginContributionInput): Promise<ExtensionDetail> {
    const pluginRoot = await this.resolvePublicPluginSource(input.pluginName);
    assertSafeName(input.sourceName, input.kind);
    const target = input.kind === 'skill'
      ? { path: join(pluginRoot, 'skills', input.sourceName, 'SKILL.md'), format: 'markdown' as const }
      : input.kind === 'hook'
        ? { path: join(pluginRoot, 'hooks', `${input.sourceName}.json`), format: 'json' as const }
        : { path: join(pluginRoot, 'mcp', `${input.sourceName}.json`), format: 'json' as const };
    const stat = await lstat(target.path);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Public plugin contribution is invalid: ${input.sourceName}.`);
    const canonicalTarget = await realpath(target.path);
    if (!isContainedPath(pluginRoot, canonicalTarget)) throw new Error('The public plugin contribution is outside the package.');
    const content = input.kind === 'mcp' ? await readMcpEntry(target.path, input.sourceName, true) : await readFile(target.path, { encoding: 'utf8' });
    if (Buffer.byteLength(content, 'utf8') > MAX_DETAIL_BYTES) throw new Error('The extension detail is too large to display.');
    return { content, format: target.format, editable: false, ...(input.kind === 'mcp' ? {} : { fileName: basename(target.path) }) };
  }

  async readPluginIcon(input: { cwd: string; name: string; scope: 'user' | 'project' }): Promise<{ mimeType: 'image/svg+xml'; data: string } | undefined> {
    const cwd = await requireDirectory(input.cwd);
    const pluginRoot = await findPluginRoot(cwd, input.name, input.scope);
    if (pluginRoot === undefined) return undefined;
    return this.readSvgIcon(pluginRoot);
  }

  private async readSvgIcon(pluginRoot: string): Promise<{ mimeType: 'image/svg+xml'; data: string } | undefined> {
    const iconPath = join(pluginRoot, 'icon.svg');
    try {
      const stat = await lstat(iconPath);
      if (!stat.isFile() || stat.size > MAX_PLUGIN_ICON_BYTES) return undefined;
      const content = await readFile(iconPath);
      if (content.byteLength > MAX_PLUGIN_ICON_BYTES) return undefined;
      const markup = content.toString('utf8');
      if (!/^\s*<svg(?:\s|>)/iu.test(markup) || /<script\b|\bon[a-z]+\s*=|javascript:/iu.test(markup)) return undefined;
      return { mimeType: 'image/svg+xml', data: content.toString('base64') };
    } catch (error) {
      if (isFileNotFound(error)) return undefined;
      throw error;
    }
  }

  async writeDetail(input: ExtensionDetailWriteInput): Promise<void> {
    if (input.kind === 'hook' || input.scope === 'project') await this.requireTrustedProject(input.cwd);
    const target = await this.resolveTarget(input);
    if (target === undefined || !target.editable) throw new Error('This extension cannot be edited from the desktop.');
    validateContent(input, target.format);
    if (input.kind === 'mcp') {
      const current = await readJsonObject(target.path);
      const edited = JSON.parse(input.content) as unknown;
      current[input.name] = restoreRedacted(current[input.name], edited);
      await writeFile(target.path, `${JSON.stringify(current, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
      return;
    }
    const writePath = target.writePath ?? target.path;
    await mkdir(dirname(writePath), { recursive: true });
    await writeFile(writePath, input.content, { encoding: 'utf8', mode: 0o600 });
  }

  private async resolveTarget(input: ExtensionDetailInput): Promise<{ path: string; writePath?: string; format: ExtensionDetail['format']; editable: boolean; sourceName?: string; directMcpEntry?: boolean } | undefined> {
    const cwd = await requireDirectory(input.cwd);
    if (input.scope === 'plugin') return this.resolvePluginTarget(cwd, input);
    if (input.kind === 'hook') {
      if (input.scope !== undefined && input.scope !== 'project') return undefined;
      assertSafeName(input.name, 'hook');
      const path = join(resolveProjectConfigPaths(cwd).hooksDir, `${input.name}.json`);
      return existsSync(path) ? { path, format: 'json', editable: true } : undefined;
    }
    if (input.kind === 'skill' && input.scope === 'builtin') {
      assertSafeName(input.name, 'skill');
      const path = join(builtinSkillsDirectory(), input.name, 'SKILL.md');
      return existsSync(path) ? { path, format: 'markdown', editable: false } : undefined;
    }
    const scopeRoot = input.scope === 'user' ? globalConfigDirectory() : resolveProjectConfigPaths(cwd).directory;
    if (input.kind === 'mcp') return { path: join(scopeRoot, 'mcp.json'), format: 'json', editable: true };
    if (input.kind === 'skill') {
      assertSafeName(input.name, 'skill');
      return { path: join(scopeRoot, 'skills', input.name, 'SKILL.md'), format: 'markdown', editable: true };
    }
    const pluginManifest = await findPluginManifest(join(scopeRoot, 'plugins'), input.name);
    return pluginManifest === undefined ? undefined : { path: pluginManifest, format: 'json', editable: true };
  }

  private async resolvePluginTarget(cwd: string, input: ExtensionDetailInput): Promise<{ path: string; format: ExtensionDetail['format']; editable: boolean; sourceName?: string; directMcpEntry?: boolean } | undefined> {
    if (input.pluginName === undefined) return undefined;
    const pluginRoot = await findPluginRoot(cwd, input.pluginName, input.pluginScope);
    if (pluginRoot === undefined) return undefined;
    if (input.kind === 'plugin') return { path: join(pluginRoot, '.lotagate-plugin', 'plugin.json'), format: 'json', editable: false };
    const sourceName = input.sourceName ?? input.name.split(':').slice(1).join(':');
    assertSafeName(sourceName, input.kind);
    if (input.kind === 'skill') return { path: join(pluginRoot, 'skills', sourceName, 'SKILL.md'), format: 'markdown', editable: false, sourceName };
    if (input.kind === 'hook') return { path: join(pluginRoot, 'hooks', `${sourceName}.json`), format: 'json', editable: false, sourceName };
    return { path: join(pluginRoot, 'mcp', `${sourceName}.json`), format: 'json', editable: false, sourceName, directMcpEntry: true };
  }

  private async requireTrustedProject(cwd: string): Promise<string> {
    const canonical = await requireDirectory(cwd);
    await this.workspaceTrust?.requireTrusted(canonical);
    return canonical;
  }
}

export interface WorkspaceTrust { requireTrusted(rootPath: string): Promise<void> }

function globalConfigDirectory(): string { return join(resolve(process.env['LOTAGATE_HOME']?.trim() || homedir()), '.lotagate'); }

function builtinSkillsDirectory(): string {
  try {
    return join(dirname(require.resolve('@lotagate/cli/package.json')), 'skills');
  } catch {
    return resolve(process.cwd(), 'cli', 'skills');
  }
}

async function findPluginManifest(root: string, name: string): Promise<string | undefined> {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const manifest = join(root, entry.name, '.lotagate-plugin', 'plugin.json');
    try {
      const value = JSON.parse(await readFile(manifest, 'utf8')) as Record<string, unknown>;
      if (value['name'] === name) return manifest;
    } catch { /* Invalid or incomplete extension entries remain CLI-owned. */ }
  }
  return undefined;
}

async function findPluginRoot(cwd: string, name: string, scope?: 'user' | 'project'): Promise<string | undefined> {
  const roots = scope === 'project' ? [join(resolveProjectConfigPaths(cwd).pluginsDir)] : scope === 'user' ? [join(globalConfigDirectory(), 'plugins')] : [join(resolveProjectConfigPaths(cwd).pluginsDir), join(globalConfigDirectory(), 'plugins')];
  for (const root of roots) {
    const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const pluginRoot = join(root, entry.name);
      const manifest = join(pluginRoot, '.lotagate-plugin', 'plugin.json');
      try {
        const value = JSON.parse(await readFile(manifest, 'utf8')) as Record<string, unknown>;
        if (value['name'] === name) return pluginRoot;
      } catch { /* Invalid plugin entries remain CLI-owned. */ }
    }
  }
  return undefined;
}

async function readMcpEntry(filePath: string, name: string, directEntry = false): Promise<string> {
  const config = await readJsonObject(filePath);
  if (directEntry) return `${JSON.stringify(redactSecrets(config), null, 2)}\n`;
  const entry = config[name];
  if (!isRecord(entry)) throw new Error(`MCP server ${name} was not found in its configuration file.`);
  return `${JSON.stringify(redactSecrets(entry), null, 2)}\n`;
}

async function readJsonObject(filePath: string): Promise<Record<string, unknown>> {
  const raw = await readFile(filePath, { encoding: 'utf8' });
  const value: unknown = JSON.parse(raw);
  if (!isRecord(value)) throw new Error('Extension configuration must be a JSON object.');
  return value;
}

function validateContent(input: ExtensionDetailWriteInput, format: ExtensionDetail['format']): void {
  if (input.content.length === 0 || Buffer.byteLength(input.content, 'utf8') > MAX_DETAIL_BYTES) throw new Error('Extension detail is empty or too large.');
  if (format === 'markdown') {
    if (!/^---\r?\n[\s\S]*\r?\n---\r?\n/u.test(input.content) || !new RegExp(`^name:\\s*${escapeRegExp(input.name)}\\s*$`, 'mu').test(input.content)) throw new Error('Skill content must contain valid frontmatter for the selected skill.');
    return;
  }
  if (format !== 'json') return;
  let value: unknown;
  try { value = JSON.parse(input.content); } catch { throw new Error('Extension detail must be valid JSON.'); }
  if (input.kind === 'mcp') {
    if (!isRecord(value) || typeof value['enabled'] !== 'boolean' || !isRecord(value['config'])) throw new Error('MCP detail must contain enabled and config fields.');
    return;
  }
  if (input.kind === 'hook') {
    const hook = isRecord(value) ? value : undefined;
    if (hook === undefined || typeof hook['event'] !== 'string' || typeof hook['command'] !== 'string' || !Array.isArray(hook['args']) || hook['args'].some(item => typeof item !== 'string') || typeof hook['timeoutMs'] !== 'number') throw new Error('Hook detail must contain event, command, args, and timeoutMs fields.');
    validateHookContent(hook['event'], hook['command'], hook['args'], hook['timeoutMs']);
    return;
  }
  if (!isRecord(value) || value['name'] !== input.name || typeof value['version'] !== 'string') throw new Error('Plugin manifest name and version are required.');
}

function validateHookContent(event: unknown, command: unknown, args: unknown, timeoutMs: unknown): void {
  if (!['session.start', 'prompt.before', 'tool.before', 'tool.after', 'response.after', 'session.end'].includes(String(event))) throw new Error('Hook event is not supported.');
  if (typeof command !== 'string' || command.trim().length === 0 || /[\r\n]/u.test(command)) throw new Error('Hook command is invalid.');
  if (!Array.isArray(args) || args.some(item => typeof item !== 'string')) throw new Error('Hook args must be strings.');
  if (typeof timeoutMs !== 'number' || !Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 120_000) throw new Error('Hook timeout must be between 100 and 120000 milliseconds.');
}

function assertSafeName(name: string, kind: string): void { if (!/^[a-z0-9][a-z0-9-]{0,63}$/u.test(name)) throw new Error(`Invalid ${kind} name.`); }
function isContainedPath(root: string, candidate: string): boolean {
  const child = relative(root, candidate);
  return child.length > 0 && !child.startsWith('..') && !isAbsolute(child);
}
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function escapeRegExp(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'); }
function describePublicMcp(config: { type?: string } | undefined): string {
  if (config?.type === 'stdio' || config?.type === 'http' || config?.type === 'sse') return `${config.type} MCP server`;
  return 'MCP server contribution';
}
function redactSecrets(value: unknown, key?: string): unknown {
  if (typeof value === 'string' && key !== undefined && isSensitiveKey(key)) return '[REDACTED]';
  if (Array.isArray(value)) return value.map(item => redactSecrets(item));
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.entries(value).map(([entryKey, entryValue]) => [entryKey, redactSecrets(entryValue, entryKey)]));
}
function restoreRedacted(original: unknown, edited: unknown, key?: string): unknown {
  if (edited === '[REDACTED]' && key !== undefined && isSensitiveKey(key)) return original;
  if (Array.isArray(edited)) return edited.map((item, index) => restoreRedacted(Array.isArray(original) ? original[index] : undefined, item));
  if (!isRecord(edited)) return edited;
  const source = isRecord(original) ? original : {};
  return Object.fromEntries(Object.entries(edited).map(([entryKey, entryValue]) => [entryKey, restoreRedacted(source[entryKey], entryValue, entryKey)]));
}
function isSensitiveKey(key: string): boolean { return /(token|secret|password|api[-_]?key|authorization)/iu.test(key); }
function isFileNotFound(error: unknown): boolean { return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: unknown }).code === 'ENOENT'; }
