import { access, lstat, realpath, stat } from 'node:fs/promises';
import { basename, dirname, isAbsolute, resolve, sep } from 'node:path';

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

/** Resolves a workspace write target while allowing missing descendants. */
export async function requireWorkspaceWritePath(input: string, root: string): Promise<string> {
  const candidate = await requireWorkspaceMutationPath(input, root);
  const entry = await lstat(candidate).catch(error => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  });
  if (entry?.isSymbolicLink()) throw new Error('Workspace write targets cannot be symbolic links.');
  return candidate;
}

/**
 * Validates a path before a checkpoint mutation. Existing ancestors are
 * inspected with lstat so a symlink cannot redirect an undo operation outside
 * the workspace. Missing descendants remain valid because restore may create
 * them. The final entry itself may be a symlink: replacing or unlinking the
 * link does not follow its target.
 */
export async function requireWorkspaceMutationPath(input: string, root: string): Promise<string> {
  const normalizedRoot = await realpath(root);
  const rawCandidate = isAbsolute(input) ? resolve(input) : resolve(root, input);
  const candidate = await canonicalizeMissingDescendant(rawCandidate);
  assertResolvedInside(candidate, normalizedRoot);

  let current = dirname(rawCandidate);
  while (true) {
    try {
      const details = await lstat(current);
      if (details.isSymbolicLink()) throw new Error('Workspace mutation paths cannot contain symbolic-link directories.');
      if (!details.isDirectory()) throw new Error('Workspace mutation parent must be a directory.');
      const resolved = await realpath(current);
      assertResolvedInside(resolved, normalizedRoot);
      if (resolved === normalizedRoot) break;
      current = dirname(current);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const parent = dirname(current);
      if (parent === current) throw new Error('Path is outside the workspace boundary.');
      current = parent;
    }
  }

  return candidate;
}

async function canonicalizeMissingDescendant(candidate: string): Promise<string> {
  const suffix = [basename(candidate)];
  let current = dirname(candidate);
  while (true) {
    try {
      return resolve(await realpath(current), ...suffix);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const parent = dirname(current);
      if (parent === current) throw new Error('Path is outside the workspace boundary.');
      suffix.unshift(basename(current));
      current = parent;
    }
  }
}

function assertResolvedInside(candidate: string, root: string): void {
  if (!isWithin(candidate, root)) throw new Error('Path is outside the workspace boundary.');
}

function isWithin(candidate: string, root: string): boolean {
  return candidate === root || candidate.startsWith(`${root}${sep}`);
}
