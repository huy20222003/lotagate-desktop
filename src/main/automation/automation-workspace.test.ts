import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runGit } from '../git/git-process.js';
import { GitService } from '../git/git-service.js';
import type { Automation } from '../../contracts/ipc/v1/automation.js';
import type { Workspace } from '../../contracts/ipc/v1/workspace.js';
import { prepareAutomationWorkspace } from './automation-workspace.js';

function automation(overrides: Partial<Automation> = {}): Automation {
  return {
    id: 'automation-1', name: 'Test automation', description: '', prompt: 'test', workspaceId: 'workspace-1',
    worktree: true, skills: [], tools: [], permissionPolicy: 'autonomous', browserAccess: 'disabled',
    schedule: { kind: 'manual' }, retryPolicy: { maxAttempts: 0, backoffMs: 1_000 }, timeoutMs: 60_000,
    notifications: false, keepSession: false, enabled: true, nextRunAt: null, lastRunAt: null, lastError: null,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), ...overrides,
  };
}

describe('prepareAutomationWorkspace', () => {
  const roots: string[] = [];
  afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

  it('creates an isolated run branch from the configured base branch and cleans it after success', async () => {
    const root = await mkdtemp(join(process.env['TEMP'] ?? '.', 'lotagate-automation-repo-'));
    const managed = await mkdtemp(join(process.env['TEMP'] ?? '.', 'lotagate-automation-managed-'));
    roots.push(root, managed);
    await runGit(['init', '-b', 'main'], root);
    await runGit(['config', 'user.name', 'LotaGate Test'], root);
    await runGit(['config', 'user.email', 'test@lotagate.invalid'], root);
    await writeFile(resolve(root, 'README.md'), 'initial\n', 'utf8');
    await runGit(['add', '.'], root);
    await runGit(['commit', '-m', 'initial'], root);

    const workspace = { id: 'workspace-1', name: 'test', rootPath: root, gitRoot: root, roots: [root], trusted: true, settings: {}, createdAt: new Date().toISOString(), lastOpenedAt: new Date().toISOString() } satisfies Workspace;
    const prepared = await prepareAutomationWorkspace(new GitService(), workspace, automation({ branch: 'main' }), 'run-1', managed);
    expect(prepared.cwd).toContain('run-1');
    expect(prepared.branch).toMatch(/^automation\/lotagate-run-1$/u);
    expect((await readFile(join(prepared.cwd, 'README.md'), 'utf8')).replace(/\r\n/gu, '\n')).toBe('initial\n');
    await prepared.cleanup(false);
    await expect(readFile(join(prepared.cwd, 'README.md'), 'utf8')).rejects.toThrow();
    expect((await runGit(['worktree', 'list', '--porcelain'], root))).not.toContain(prepared.cwd);
    expect((await runGit(['branch', '--format=%(refname:short)'], root)).split(/\r?\n/u)).toContain(prepared.branch);
  });

  it('does not allow a branch setting to mutate the primary checkout', async () => {
    const root = await mkdtemp(join(process.env['TEMP'] ?? '.', 'lotagate-automation-no-worktree-'));
    roots.push(root);
    const workspace = { id: 'workspace-1', name: 'test', rootPath: root, roots: [root], trusted: true, settings: {}, createdAt: new Date().toISOString(), lastOpenedAt: new Date().toISOString() } satisfies Workspace;
    await expect(prepareAutomationWorkspace(new GitService(), workspace, automation({ worktree: false, branch: 'main' }), 'run-1', root)).rejects.toThrow('requires worktree isolation');
  });
});
