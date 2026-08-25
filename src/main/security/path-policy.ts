import { access, realpath, stat } from 'node:fs/promises';
import { isAbsolute, resolve, sep } from 'node:path';

export async function requireDirectory(input: string): Promise<string> {
  if (!isAbsolute(input)) throw new Error('Workspace paths must be absolute.');
  const normalized = await realpath(resolve(input));
  const details = await stat(normalized);
  if (!details.isDirectory()) throw new Error('Workspace path must be a directory.');
  return normalized;
}

export async function requireExistingPath(input: string, root: string): Promise<string> {
  const normalizedRoot = await realpath(root);
  const candidate = await realpath(isAbsolute(input) ? resolve(input) : resolve(normalizedRoot, input));
  if (candidate !== normalizedRoot && !candidate.startsWith(`${normalizedRoot}${sep}`)) throw new Error('Path is outside the workspace boundary.');
  await access(candidate);
  return candidate;
}

export function assertPathInside(input: string, root: string): string {
  const normalizedRoot = resolve(root);
  const candidate = isAbsolute(input) ? resolve(input) : resolve(normalizedRoot, input);
  if (candidate !== normalizedRoot && !candidate.startsWith(`${normalizedRoot}${sep}`)) throw new Error('Path is outside the workspace boundary.');
  return candidate;
}
