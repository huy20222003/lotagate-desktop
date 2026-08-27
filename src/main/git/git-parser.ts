import type { GitBranch, GitCommit, GitFileChange, GitFileStatus, GitStash, GitRepositorySnapshot } from '../../contracts/ipc/v1/workspace.js';

export function parseStatusV2(output: string, root: string, exitCode: number, stderr: string): GitRepositorySnapshot {
  const records = output.split('\0').filter(Boolean);
  let branch: string | undefined;
  let detached = false;
  let upstream: string | undefined;
  let ahead = 0;
  let behind = 0;
  const changes: GitFileChange[] = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index] ?? '';
    if (record.startsWith('# ')) {
      const metadata = record.slice(2);
      if (metadata.startsWith('branch.head ')) {
        const value = metadata.slice('branch.head '.length);
        detached = value === '(detached)';
        branch = detached ? undefined : value;
      } else if (metadata.startsWith('branch.upstream ')) {
        upstream = metadata.slice('branch.upstream '.length);
      } else if (metadata.startsWith('branch.ab ')) {
        const match = /^([+-]\d+) ([+-]\d+)$/u.exec(metadata.slice('branch.ab '.length));
        if (match) { ahead = Number(match[1]); behind = Math.abs(Number(match[2])); }
      }
      continue;
    }
    const kind = record[0];
    if (kind === '?' || kind === '!') {
      const path = record.slice(2);
      changes.push({ path, status: kind === '?' ? 'untracked' : 'ignored', indexStatus: kind, worktreeStatus: kind, staged: false, unstaged: kind === '?', binary: false });
      continue;
    }
    if (kind === 'u') {
      const fields = record.split(' ');
      const path = fields.slice(11).join(' ');
      changes.push({ path, status: 'conflicted', indexStatus: fields[1]?.[0] ?? 'U', worktreeStatus: fields[1]?.[1] ?? 'U', staged: true, unstaged: true, binary: false });
      continue;
    }
    if (kind !== '1' && kind !== '2') continue;
    const fields = record.split(' ');
    const xy = fields[1] ?? '  ';
    const pathIndex = kind === '2' ? 9 : 8;
    const path = fields.slice(pathIndex).join(' ');
    const status = statusForXY(xy);
    const originalPath = kind === '2' ? records[index + 1] : undefined;
    if (kind === '2') index += 1;
    changes.push({ path, ...(originalPath === undefined ? {} : { originalPath }), status, indexStatus: xy[0] ?? ' ', worktreeStatus: xy[1] ?? ' ', staged: xy[0] !== ' ' && xy[0] !== '?' && xy[0] !== '.', unstaged: xy[1] !== ' ' && xy[1] !== '?' && xy[1] !== '.', binary: false });
  }
  return { root, ...(branch === undefined ? {} : { branch }), detached, ...(upstream === undefined ? {} : { upstream }), ahead, behind, clean: changes.length === 0, conflicts: changes.filter(change => change.status === 'conflicted').length, changes, exitCode, stderr, updatedAt: new Date().toISOString() };
}

function statusForXY(xy: string): GitFileStatus {
  if (xy.includes('U')) return 'conflicted';
  if (xy.includes('R')) return 'renamed';
  if (xy.includes('C')) return 'copied';
  if (xy.includes('D')) return 'deleted';
  if (xy.includes('A')) return 'added';
  return 'modified';
}

export function parseBranches(output: string): GitBranch[] {
  return output.split('\0').filter(Boolean).map(record => {
    const [name = '', head = '', upstream = '', track = ''] = record.split('\t');
    const ahead = Number(/ahead (\d+)/u.exec(track)?.[1] ?? 0);
    const behind = Number(/behind (\d+)/u.exec(track)?.[1] ?? 0);
    return { name, current: head === '*', remote: name.startsWith('refs/remotes/'), ...(upstream ? { upstream } : {}), ahead, behind };
  });
}

export function parseHistory(output: string): GitCommit[] {
  return output.split('\0').filter(Boolean).map(record => {
    const [hash = '', shortHash = '', subject = '', author = '', authoredAt = '', parents = ''] = record.split('\x1f');
    return { hash, shortHash, subject, author, authoredAt, parents: parents ? parents.split(' ') : [] };
  });
}

export function parseStashes(output: string): GitStash[] {
  return output.split('\0').filter(Boolean).map(record => {
    const separator = record.indexOf(' ');
    return { reference: separator < 0 ? record : record.slice(0, separator), message: separator < 0 ? '' : record.slice(separator + 1) };
  });
}
