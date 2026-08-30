import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

export function globalCheckpointRoot(): string {
  const home = process.env['LOTAGATE_HOME']?.trim() || homedir();
  return join(resolve(home), '.lotagate', 'checkpoints');
}

export function checkpointWorkspaceDirectory(root: string): string {
  const fingerprint = createHash('sha256').update(resolve(root)).digest('hex');
  return join(globalCheckpointRoot(), 'workspaces', fingerprint);
}
