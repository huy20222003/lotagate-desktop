import { mkdir, readFile, writeFile } from 'node:fs/promises';
import type { GitBranch, GitCommit, GitOperationResult, GitRepositorySnapshot, GitStash } from '../../contracts/ipc/v1/workspace.js';
import { requireDirectory, assertPathInside } from '../security/path-policy.js';
import { runGitResult, type GitResult } from './git-process.js';
import { parseBranches, parseHistory, parseStashes, parseStatusV2 } from './git-parser.js';

export type GitErrorCode = 'AUTH_REQUIRED' | 'REMOTE_UNAVAILABLE' | 'BRANCH_REJECTED' | 'CONFLICT' | 'DIRTY_WORKTREE' | 'INVALID_REPOSITORY' | 'PERMISSION_DENIED' | 'UNKNOWN_GIT_ERROR';

export class GitCommandError extends Error {
  constructor(public readonly code: GitErrorCode, message: string, public readonly result: GitResult) {
    super(message);
    this.name = 'GitCommandError';
  }
}

export class GitService {
  async status(cwd: string): Promise<GitRepositorySnapshot> {
    const root = await requireDirectory(cwd);
    const result = await runGitResult(['status', '--porcelain=v2', '--branch', '-z'], root);
    return parseStatusV2(result.stdout, root, result.exitCode, sanitizeGitText(result.stderr));
  }

  async diff(cwd: string, staged = false): Promise<string> {
    const root = await requireDirectory(cwd);
    return (await this.runChecked(staged ? ['diff', '--cached', '--no-ext-diff'] : ['diff', '--no-ext-diff'], root, 'Unable to read Git diff.')).stdout;
  }

  async fileDiff(cwd: string, path: string, staged = false): Promise<string> {
    const root = await requireDirectory(cwd);
    const target = assertPathInside(path, root);
    return (await this.runChecked(staged ? ['diff', '--cached', '--no-ext-diff', '--', target] : ['diff', '--no-ext-diff', '--', target], root, 'Unable to read file diff.')).stdout;
  }

  async branches(cwd: string): Promise<string[]> {
    const root = await requireDirectory(cwd);
    return (await this.runChecked(['branch', '--format=%(refname:short)'], root, 'Unable to list Git branches.')).stdout.split(/\r?\n/u).filter(Boolean);
  }

  async branchList(cwd: string): Promise<GitBranch[]> {
    const root = await requireDirectory(cwd);
    const output = (await this.runChecked(['for-each-ref', '--format=%(refname:short)%09%(HEAD)%09%(upstream:short)%09%(upstream:track)%00', 'refs/heads'], root, 'Unable to list Git branches.')).stdout;
    return parseBranches(output);
  }

  async stage(cwd: string, path: string): Promise<void> {
    const root = await requireDirectory(cwd);
    await this.runChecked(['add', '--', assertPathInside(path, root)], root, 'Unable to stage file.');
  }

  async stageAll(cwd: string): Promise<void> {
    const root = await requireDirectory(cwd);
    await this.runChecked(['add', '-A'], root, 'Unable to stage changes.');
  }

  async unstage(cwd: string, path: string): Promise<void> {
    const root = await requireDirectory(cwd);
    await this.runChecked(['restore', '--staged', '--', assertPathInside(path, root)], root, 'Unable to unstage file.');
  }

  async unstageAll(cwd: string): Promise<void> {
    const root = await requireDirectory(cwd);
    await this.runChecked(['restore', '--staged', '--', '.'], root, 'Unable to unstage changes.');
  }

  async commit(cwd: string, message: string): Promise<Record<string, unknown>> {
    const root = await requireDirectory(cwd);
    const normalized = message.trim();
    if (normalized.length === 0 || normalized.length > 500) throw new Error('Commit message must contain 1 to 500 characters.');
    const result = await this.runChecked(['commit', '-m', normalized], root, 'Unable to create commit.');
    return { output: result.stdout, exitCode: result.exitCode, stderr: result.stderr };
  }

  async createBranch(cwd: string, branch: string): Promise<void> {
    const root = await requireDirectory(cwd);
    validateBranch(branch);
    await this.runChecked(['switch', '-c', branch], root, 'Unable to create branch.');
  }

  async checkout(cwd: string, branch: string, confirmed: boolean): Promise<void> {
    const root = await requireDirectory(cwd);
    validateBranch(branch);
    const snapshot = await this.status(root);
    if (!snapshot.clean && !confirmed) throw new GitCommandError('DIRTY_WORKTREE', 'Checkout requires confirmation while the worktree has uncommitted changes.', { stdout: '', stderr: '', exitCode: 1 });
    await this.runChecked(['switch', branch], root, 'Unable to switch branch.');
  }

  async fetch(cwd: string): Promise<GitOperationResult> {
    const root = await requireDirectory(cwd);
    return this.operation(await this.runChecked(['fetch', '--prune'], root, 'Unable to fetch from the Git remote.'));
  }

  async pull(cwd: string): Promise<GitOperationResult> {
    const root = await requireDirectory(cwd);
    return this.operation(await this.runChecked(['pull', '--ff-only'], root, 'Unable to pull from the Git remote.'));
  }

  async push(cwd: string, confirmed: boolean): Promise<GitOperationResult> {
    if (!confirmed) throw new GitCommandError('PERMISSION_DENIED', 'Push requires explicit confirmation.', { stdout: '', stderr: '', exitCode: 1 });
    const root = await requireDirectory(cwd);
    return this.operation(await this.runChecked(['push'], root, 'Unable to push to the Git remote.'));
  }

  async history(cwd: string, limit = 50): Promise<GitCommit[]> {
    const root = await requireDirectory(cwd);
    const normalizedLimit = Number.isInteger(limit) ? Math.min(Math.max(limit, 1), 200) : 50;
    const format = '%H%x1f%h%x1f%s%x1f%an%x1f%aI%x1f%P%x00';
    return parseHistory((await this.runChecked(['log', `-${normalizedLimit}`, `--pretty=format:${format}`], root, 'Unable to read Git history.')).stdout);
  }

  async stashList(cwd: string): Promise<GitStash[]> {
    const root = await requireDirectory(cwd);
    return parseStashes((await this.runChecked(['stash', 'list', '--format=%gd %s%x00'], root, 'Unable to list Git stashes.')).stdout);
  }

  async stashSave(cwd: string, message?: string): Promise<GitOperationResult> {
    const root = await requireDirectory(cwd);
    const normalized = message?.trim();
    if (normalized !== undefined && normalized.length > 500) throw new Error('Stash message must contain at most 500 characters.');
    const args = normalized ? ['stash', 'push', '-u', '-m', normalized] : ['stash', 'push', '-u'];
    return this.operation(await this.runChecked(args, root, 'Unable to create Git stash.'));
  }

  async stashApply(cwd: string, reference: string): Promise<GitOperationResult> {
    const root = await requireDirectory(cwd);
    validateReference(reference);
    return this.operation(await this.runChecked(['stash', 'apply', reference], root, 'Unable to apply Git stash.'));
  }

  async stashDrop(cwd: string, reference: string, confirmed: boolean): Promise<GitOperationResult> {
    if (!confirmed) throw new GitCommandError('PERMISSION_DENIED', 'Dropping a stash requires explicit confirmation.', { stdout: '', stderr: '', exitCode: 1 });
    const root = await requireDirectory(cwd);
    validateReference(reference);
    return this.operation(await this.runChecked(['stash', 'drop', reference], root, 'Unable to drop Git stash.'));
  }

  async exportPatch(cwd: string, staged = false): Promise<string> { return this.diff(cwd, staged); }

  async worktreeAdd(cwd: string, worktreePath: string, branch: string): Promise<Record<string, unknown>> {
    const root = await requireDirectory(cwd);
    validateBranch(branch);
    const target = assertPathInside(worktreePath, root);
    if (target === root) throw new Error('A worktree must be different from the repository root.');
    await mkdir(target, { recursive: true });
    await this.runChecked(['worktree', 'add', target, branch], root, 'Unable to create worktree.');
    return { path: target, branch };
  }

  async worktreeRemove(cwd: string, worktreePath: string, confirmed: boolean): Promise<void> {
    if (!confirmed) throw new GitCommandError('PERMISSION_DENIED', 'Worktree removal requires explicit confirmation.', { stdout: '', stderr: '', exitCode: 1 });
    const root = await requireDirectory(cwd);
    const target = assertPathInside(worktreePath, root);
    if (target === root) throw new Error('The repository root cannot be removed as a worktree.');
    await this.runChecked(['worktree', 'remove', '--force', target], root, 'Unable to remove worktree.');
  }

  async writeFile(cwd: string, path: string, content: string): Promise<void> {
    const root = await requireDirectory(cwd);
    await writeFile(assertPathInside(path, root), content, 'utf8');
  }

  async readFile(cwd: string, path: string): Promise<string> {
    const root = await requireDirectory(cwd);
    return readFile(assertPathInside(path, root), 'utf8');
  }

  async restore(cwd: string, path: string, confirmed: boolean): Promise<void> {
    if (!confirmed) throw new GitCommandError('PERMISSION_DENIED', 'Restore requires explicit confirmation.', { stdout: '', stderr: '', exitCode: 1 });
    const root = await requireDirectory(cwd);
    await this.runChecked(['restore', '--', assertPathInside(path, root)], root, 'Unable to restore file.');
  }

  private async runChecked(args: string[], cwd: string, fallback: string): Promise<GitResult> {
    const result = await runGitResult(args, cwd);
    if (result.exitCode !== 0) throw createGitError(result, fallback);
    return result;
  }

  private operation(result: GitResult): GitOperationResult { return { output: sanitizeGitText(result.stdout.trim()), exitCode: result.exitCode, stderr: sanitizeGitText(result.stderr.trim()) }; }
}

function validateBranch(branch: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,150}$/u.test(branch) || branch.includes('..') || branch.endsWith('/') || branch.endsWith('.')) throw new Error('Invalid Git branch name.');
}

function validateReference(reference: string): void {
  if (!/^(?:stash@\{\d+\}|[A-Za-z0-9._/-]{1,200})$/u.test(reference)) throw new Error('Invalid Git reference.');
}

function createGitError(result: GitResult, fallback: string): GitCommandError {
  const safeResult = { stdout: sanitizeGitText(result.stdout), stderr: sanitizeGitText(result.stderr), exitCode: result.exitCode };
  const detail = `${safeResult.stderr}\n${safeResult.stdout}`.trim();
  const normalized = detail.toLowerCase();
  let code: GitErrorCode = 'UNKNOWN_GIT_ERROR';
  if (/authentication failed|could not read username|permission denied \(publickey\)|invalid username or token|access denied/u.test(normalized)) code = 'AUTH_REQUIRED';
  else if (/could not resolve host|connection timed out|failed to connect|network is unreachable|no such device or address/u.test(normalized)) code = 'REMOTE_UNAVAILABLE';
  else if (/non-fast-forward|rejected|failed to push some refs/u.test(normalized)) code = 'BRANCH_REJECTED';
  else if (/conflict|cannot merge|unmerged paths|you have not concluded your merge/u.test(normalized)) code = 'CONFLICT';
  else if (/not a git repository/u.test(normalized)) code = 'INVALID_REPOSITORY';
  else if (/permission denied|access is denied/u.test(normalized)) code = 'PERMISSION_DENIED';
  return new GitCommandError(code, detail || fallback, safeResult);
}

export function sanitizeGitText(value: string): string {
  return value.replace(/(https?:\/\/)([^\s/@]+)@/giu, '$1[redacted]@').replace(/(password|token|authorization)(\s*[:=]\s*)[^\s]+/giu, '$1$2[redacted]');
}
