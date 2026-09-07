import { lstat, opendir, readFile, readlink, realpath } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import type { WorkspaceEntry } from './checkpoint-types.js';
import { IGNORED_DIRECTORIES } from './checkpoint-constants.js';

export async function scanWorkspace(root: string): Promise<Map<string, WorkspaceEntry>> {
  const entries = new Map<string, WorkspaceEntry>();
  const normalizedRoot = await realpath(root);
  await visit(normalizedRoot, normalizedRoot, entries);
  return entries;
}

async function visit(root: string, directory: string, entries: Map<string, WorkspaceEntry>): Promise<void> {
  const handle = await opendir(directory);
  for await (const entry of handle) {
    if (entry.isDirectory() && IGNORED_DIRECTORIES.has(entry.name)) continue;
    const absolute = join(directory, entry.name);
    const relativePath = relative(root, absolute).split(sep).join('/');
    const details = await lstat(absolute);
    if (details.isDirectory()) { await visit(root, absolute, entries); continue; }
    if (details.isSymbolicLink()) {
      const target = await readlink(absolute);
      entries.set(relativePath, { kind: 'symlink', bytes: Buffer.from(target, 'utf8') });
      continue;
    }
    if (!details.isFile()) continue;
    entries.set(relativePath, { kind: 'file', bytes: await readFile(absolute) });
  }
}
