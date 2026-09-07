import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runGit } from './git-process.js';
import { GitService } from './git-service.js';

const GIT_INTEGRATION_TEST_TIMEOUT_MS = 15_000;

describe('GitService', () => {
  const roots: string[] = [];
  const service = new GitService();

  afterEach(async () => {
    await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })));
  });

  it('reads and mutates a repository through the service boundary', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lotagate-git-service-'));
    roots.push(root);
    await runGit(['init', '-b', 'main'], root);
    // Git for Windows may launch background maintenance after commits, which
    // races with temporary-directory cleanup and makes this integration test flaky.
    await runGit(['config', 'maintenance.auto', 'false'], root);
    await runGit(['config', 'user.name', 'LotaGate Test'], root);
    await runGit(['config', 'user.email', 'test@lotagate.invalid'], root);
    await runGit(['remote', 'add', 'origin', 'https://github.com/huy20222003/lotagate-desktop.git'], root);
    await writeFile(resolve(root, 'file.txt'), 'one\n', 'utf8');
    await runGit(['add', '.'], root);
    await runGit(['commit', '-m', 'initial'], root);
    await writeFile(resolve(root, 'file.txt'), 'two\n', 'utf8');

    const beforeStage = await service.status(root);
    expect(beforeStage.repositoryName).toBe('lotagate-desktop');
    expect(beforeStage.branch).toBe('main');
    expect(beforeStage.changes).toEqual([expect.objectContaining({ path: 'file.txt', unstaged: true })]);
    await service.stage(root, 'file.txt');
    expect((await service.status(root)).changes).toEqual([expect.objectContaining({ path: 'file.txt', staged: true, unstaged: false })]);
    await service.commit(root, 'update file');
    expect((await service.history(root, 2)).map(commit => commit.subject)).toEqual(['update file', 'initial']);
  }, GIT_INTEGRATION_TEST_TIMEOUT_MS);

  it('rejects worktree destinations outside the repository', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lotagate-git-security-'));
    roots.push(root);
    await runGit(['init', '-b', 'main'], root);
    await expect(service.worktreeAdd(root, resolve(root, '..', 'outside-worktree'), 'main')).rejects.toThrow('outside the workspace boundary');
  });
});
