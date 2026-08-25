import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { requireDirectory, assertPathInside } from '../security/path-policy.js';
import { runGitResult } from './git-process.js';

export class GitService {
  async status(cwd: string): Promise<Record<string, unknown>> {
    const root = await requireDirectory(cwd);
    const result = await runGitResult(['status', '--porcelain=v1', '--branch'], root);
    const lines = result.stdout.split(/\r?\n/u).filter(Boolean);
    const branchLine = lines.shift() ?? '';
    return { root, branch: branchLine.replace(/^##\s*/u, '').split('...')[0] ?? '', clean: lines.length === 0, changes: lines.map(parseStatusLine), exitCode: result.exitCode, stderr: result.stderr };
  }

  async diff(cwd: string, staged = false): Promise<string> {
    const root = await requireDirectory(cwd);
    return (await runGitResult(staged ? ['diff', '--cached', '--no-ext-diff'] : ['diff', '--no-ext-diff'], root)).stdout;
  }

  async branches(cwd: string): Promise<string[]> {
    const root = await requireDirectory(cwd);
    return (await runGitResult(['branch', '--format=%(refname:short)'], root)).stdout.split(/\r?\n/u).filter(Boolean);
  }

  async stage(cwd: string, path: string): Promise<void> {
    const root = await requireDirectory(cwd);
    const target = assertPathInside(path, root);
    const result = await runGitResult(['add', '--', target], root);
    if (result.exitCode !== 0) throw new Error(result.stderr || 'Unable to stage file.');
  }

  async unstage(cwd: string, path: string): Promise<void> {
    const root = await requireDirectory(cwd);
    const target = assertPathInside(path, root);
    const result = await runGitResult(['restore', '--staged', '--', target], root);
    if (result.exitCode !== 0) throw new Error(result.stderr || 'Unable to unstage file.');
  }

  async commit(cwd: string, message: string): Promise<Record<string, unknown>> {
    const root = await requireDirectory(cwd);
    const normalized = message.trim();
    if (normalized.length === 0 || normalized.length > 500) throw new Error('Commit message must contain 1 to 500 characters.');
    const result = await runGitResult(['commit', '-m', normalized], root);
    if (result.exitCode !== 0) throw new Error(result.stderr || result.stdout || 'Unable to create commit.');
    return { output: result.stdout };
  }

  async createBranch(cwd: string, branch: string): Promise<void> {
    const root = await requireDirectory(cwd);
    if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,150}$/u.test(branch) || branch.includes('..') || branch.endsWith('/')) throw new Error('Invalid Git branch name.');
    const result = await runGitResult(['switch', '-c', branch], root);
    if (result.exitCode !== 0) throw new Error(result.stderr || 'Unable to create branch.');
  }

  async exportPatch(cwd: string, staged = false): Promise<string> {
    return this.diff(cwd, staged);
  }

  async worktreeAdd(cwd: string, worktreePath: string, branch: string): Promise<Record<string, unknown>> {
    const root = await requireDirectory(cwd);
    const target = resolve(worktreePath);
    await mkdir(target, { recursive: true });
    const result = await runGitResult(['worktree', 'add', target, branch], root);
    if (result.exitCode !== 0) throw new Error(result.stderr || 'Unable to create worktree.');
    return { path: target, branch };
  }

  async worktreeRemove(cwd: string, worktreePath: string, confirmed: boolean): Promise<void> {
    if (!confirmed) throw new Error('Worktree removal requires explicit confirmation.');
    const root = await requireDirectory(cwd);
    const target = resolve(worktreePath);
    const result = await runGitResult(['worktree', 'remove', '--force', target], root);
    if (result.exitCode !== 0) throw new Error(result.stderr || 'Unable to remove worktree.');
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
    if (!confirmed) throw new Error('Restore requires explicit confirmation.');
    const root = await requireDirectory(cwd);
    const target = assertPathInside(path, root);
    const result = await runGitResult(['restore', '--', target], root);
    if (result.exitCode !== 0) throw new Error(result.stderr || 'Unable to restore file.');
  }
}

function parseStatusLine(line: string): Record<string, string> { return { index: line.slice(0, 1), worktree: line.slice(1, 2), path: line.slice(3) }; }
