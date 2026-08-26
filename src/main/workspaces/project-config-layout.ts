import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export interface ProjectConfigPaths {
  directory: string;
  settings: string;
  localSettings: string;
  gitignore: string;
  skillsDir: string;
  pluginsDir: string;
  hooksDir: string;
  mcpConfig: string;
}

export function resolveProjectConfigPaths(cwd: string): ProjectConfigPaths {
  const directory = join(cwd, '.lotagate');
  return {
    directory,
    settings: join(directory, 'settings.json'),
    localSettings: join(directory, 'settings.local.json'),
    gitignore: join(directory, '.gitignore'),
    skillsDir: join(directory, 'skills'),
    pluginsDir: join(directory, 'plugins'),
    hooksDir: join(directory, 'hooks'),
    mcpConfig: join(directory, 'mcp.json'),
  };
}

export async function ensureProjectConfig(cwd: string): Promise<ProjectConfigPaths> {
  const paths = resolveProjectConfigPaths(cwd);
  await mkdir(paths.directory, { recursive: true });
  await Promise.all([paths.skillsDir, paths.pluginsDir, paths.hooksDir].map(directory => mkdir(directory, { recursive: true })));
  await createIfMissing(paths.settings, `${JSON.stringify(defaultSettings(), null, 2)}\n`);
  await createIfMissing(paths.localSettings, `${JSON.stringify(defaultSettings(), null, 2)}\n`);
  await createIfMissing(paths.gitignore, 'settings.local.json\n');
  return paths;
}

async function createIfMissing(filePath: string, content: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  try { await writeFile(filePath, content, { encoding: 'utf8', mode: 0o600, flag: 'wx' }); }
  catch (error) { if (!isAlreadyExists(error)) throw error; }
}

function defaultSettings(): { schemaVersion: 1; permissions: { allow: string[]; ask: string[]; deny: string[] } } {
  return { schemaVersion: 1, permissions: { allow: [], ask: [], deny: [] } };
}

function isAlreadyExists(error: unknown): boolean { return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: unknown }).code === 'EEXIST'; }
