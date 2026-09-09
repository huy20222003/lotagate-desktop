import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, join, sep } from 'node:path';
import { cliExecutableName } from './cli-executable-name.js';
import { CLI_EXECUTABLE, CLI_NODE_LAUNCHER, CLI_PACKAGE_JSON } from './agent-constants.js';

export interface CliInvocation {
  executable: string;
  executableArgs: readonly string[];
}

export class CliResolutionError extends Error {
  constructor(message: string, options?: unknown) {
    super(message, { cause: options });
    this.name = 'CliResolutionError';
  }
}

export interface CliPackageResolutionOptions {
  exists?: (path: string) => boolean;
  nodeExecutable?: string;
}

export function resolveCliInvocation(): CliInvocation {
  const nativeName = cliExecutableName();
  const packagedExecutable = typeof process.resourcesPath === 'string' ? join(process.resourcesPath, nativeName) : undefined;
  if (packagedExecutable !== undefined && existsSync(packagedExecutable)) return { executable: packagedExecutable, executableArgs: [] };

  const require = createRequire(import.meta.url);
  let packageJsonPath: string;
  try {
    packageJsonPath = require.resolve(CLI_PACKAGE_JSON);
  } catch (error) {
    throw new CliResolutionError('The @lotagate/cli package is not installed in the desktop application.', error);
  }

  const packageRoot = dirname(packageJsonPath);
  return resolveCliPackageInvocation(packageRoot);
}

export function resolveCliPackageInvocation(packageRoot: string, options: CliPackageResolutionOptions = {}): CliInvocation {
  const exists = options.exists ?? existsSync;
  const localLauncher = join(packageRoot, CLI_NODE_LAUNCHER);
  if (exists(join(packageRoot, '.git')) && exists(localLauncher)) return { executable: options.nodeExecutable ?? resolveNodeExecutable(), executableArgs: [localLauncher] };
  const packagedPath = join(packageRoot, CLI_EXECUTABLE);
  const candidates = [packagedPath, resolveAsarUnpacked(packagedPath)].filter((value): value is string => value !== undefined);
  const executable = candidates.find(candidate => exists(candidate));
  if (executable !== undefined) return { executable, executableArgs: [] };
  throw new CliResolutionError(`The packaged @lotagate/cli executable was not installed at ${CLI_EXECUTABLE}. Reinstall LotaGate Desktop to restore the complete application package.`);
}

function resolveNodeExecutable(): string {
  const configuredExecutables = [process.env['npm_node_execpath'], process.env['NODE']].flatMap(value => typeof value === 'string' && value.trim() !== '' ? [value.trim()] : []);
  const configuredNode = configuredExecutables.find(isNodeExecutable);
  if (configuredNode !== undefined) return configuredNode;
  if (process.versions.electron !== undefined) return process.platform === 'win32' ? 'node.exe' : 'node';
  return process.execPath;
}

function isNodeExecutable(value: string): boolean {
  const executableName = basename(value).toLocaleLowerCase();
  return (executableName === 'node' || executableName === 'node.exe') && !executableName.includes('electron');
}

function resolveAsarUnpacked(path: string): string | undefined {
  const marker = `${sep}app.asar${sep}`;
  const markerIndex = path.lastIndexOf(marker);
  if (markerIndex < 0) return undefined;
  return join(path.slice(0, markerIndex), 'app.asar.unpacked', path.slice(markerIndex + marker.length));
}
