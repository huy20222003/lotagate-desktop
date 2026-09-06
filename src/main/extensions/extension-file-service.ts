import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, realpath, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import type { ExtensionDetail, ExtensionDetailInput, ExtensionDetailWriteInput, HookCreateInput, PublicPluginCatalogEntry, PublicPluginContributionInput } from '../../contracts/ipc/v1/extensions.js';
import { requireDirectory } from '../security/path-policy.js';
import { ensureProjectConfig, resolveProjectConfigPaths } from '../workspaces/project-config-layout.js';
import type { ExtensionProtocol } from './extension-protocol.js';

const MAX_DETAIL_BYTES = 2 * 1024 * 1024;

export class ExtensionFileService {
  constructor(private readonly workspaceTrust?: WorkspaceTrust, private readonly publicPluginRoot?: string, private readonly extensionProtocol?: ExtensionProtocol) {}

  async listPublicPlugins(): Promise<readonly PublicPluginCatalogEntry[]> {
    if (this.publicPluginRoot === undefined) return [];
    const root = await realpath(this.publicPluginRoot);
    return this.requireExtensionProtocol().listPublicPlugins(root);
  }

  async resolvePublicPluginSource(name: string): Promise<string> {
    assertSafeName(name, 'public plugin');
    if (this.publicPluginRoot === undefined) throw new Error('The public plugin catalog is not available.');
    const root = await realpath(this.publicPluginRoot);
    return this.requireExtensionProtocol().resolvePublicPluginSource(root, name);
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
    if (input.kind === 'plugin' || input.scope === 'plugin' || input.scope === 'builtin') {
      const { cwd, ...protocolInput } = input;
      return this.requireExtensionProtocol().readDetail(await requireDirectory(cwd), protocolInput);
    }
    const target = await this.resolveTarget(input);
    if (target === undefined) return { content: 'This item is provided by the CLI and has no editable project file.', format: 'text', editable: false };
    const content = input.kind === 'mcp' ? await readMcpEntry(target.path, target.sourceName ?? input.name, target.directMcpEntry === true) : await readFile(target.path, { encoding: 'utf8' });
    if (Buffer.byteLength(content, 'utf8') > MAX_DETAIL_BYTES) throw new Error('The extension detail is too large to display.');
    return { content, format: target.format, editable: target.editable, ...(input.kind === 'mcp' ? {} : { fileName: basename(target.path) }) };
  }

  async readPublicPluginContribution(input: PublicPluginContributionInput): Promise<ExtensionDetail> {
    if (this.publicPluginRoot === undefined) throw new Error('The public plugin catalog is not available.');
    return this.requireExtensionProtocol().readPublicPluginContribution(await realpath(this.publicPluginRoot), input);
  }

  async readPluginIcon(input: { cwd: string; name: string; scope: 'user' | 'project' }): Promise<{ mimeType: 'image/svg+xml'; data: string } | undefined> {
    return this.requireExtensionProtocol().readPluginIcon(await requireDirectory(input.cwd), { name: input.name, scope: input.scope });
  }

  async writeDetail(input: ExtensionDetailWriteInput): Promise<void> {
    if (input.scope === 'builtin' || input.scope === 'plugin') throw new Error('This extension cannot be edited from the desktop.');
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
    if (input.kind === 'hook') {
      if (input.scope !== undefined && input.scope !== 'project') return undefined;
      assertSafeName(input.name, 'hook');
      const path = join(resolveProjectConfigPaths(cwd).hooksDir, `${input.name}.json`);
      return existsSync(path) ? { path, format: 'json', editable: true } : undefined;
    }
    const scopeRoot = input.scope === 'user' ? globalConfigDirectory() : resolveProjectConfigPaths(cwd).directory;
    if (input.kind === 'mcp') return { path: join(scopeRoot, 'mcp.json'), format: 'json', editable: true };
    if (input.kind === 'skill') {
      assertSafeName(input.name, 'skill');
      return { path: join(scopeRoot, 'skills', input.name, 'SKILL.md'), format: 'markdown', editable: true };
    }
    return undefined;
  }

  private requireExtensionProtocol(): ExtensionProtocol { if (this.extensionProtocol === undefined) throw new Error('The CLI extension protocol is unavailable.'); return this.extensionProtocol; }

  private async requireTrustedProject(cwd: string): Promise<string> {
    const canonical = await requireDirectory(cwd);
    await this.workspaceTrust?.requireTrusted(canonical);
    return canonical;
  }
}

export interface WorkspaceTrust { requireTrusted(rootPath: string): Promise<void> }

function globalConfigDirectory(): string { return join(process.env['LOTAGATE_HOME']?.trim() || homedir(), '.lotagate'); }

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
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function escapeRegExp(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'); }
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
