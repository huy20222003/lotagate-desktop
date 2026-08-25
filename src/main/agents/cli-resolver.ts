import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, sep } from 'node:path';

const CLI_PACKAGE_JSON = '@lotagate/cli/package.json';
const CLI_EXECUTABLE = join('bin', 'lotagate.exe');

export class CliResolutionError extends Error {
  constructor(message: string, options?: unknown) {
    super(message, { cause: options });
    this.name = 'CliResolutionError';
  }
}

export function resolveCliExecutable(): string {
  const packagedExecutable = typeof process.resourcesPath === 'string' ? join(process.resourcesPath, 'lotagate.exe') : undefined;
  if (packagedExecutable !== undefined && existsSync(packagedExecutable)) return packagedExecutable;

  const require = createRequire(import.meta.url);
  let packageJsonPath: string;
  try {
    packageJsonPath = require.resolve(CLI_PACKAGE_JSON);
  } catch (error) {
    throw new CliResolutionError('The @lotagate/cli package is not installed in the desktop application.', error);
  }

  const packageRoot = dirname(packageJsonPath);
  const packagedPath = join(packageRoot, CLI_EXECUTABLE);
  const candidates = [packagedPath, resolveAsarUnpacked(packagedPath)].filter((value): value is string => value !== undefined);
  const executable = candidates.find(candidate => existsSync(candidate));
  if (executable !== undefined) return executable;
  throw new CliResolutionError(`The @lotagate/cli executable was not installed at ${CLI_EXECUTABLE}.`);
}

function resolveAsarUnpacked(path: string): string | undefined {
  const marker = `${sep}app.asar${sep}`;
  const markerIndex = path.lastIndexOf(marker);
  if (markerIndex < 0) return undefined;
  return join(path.slice(0, markerIndex), 'app.asar.unpacked', path.slice(markerIndex + marker.length));
}
