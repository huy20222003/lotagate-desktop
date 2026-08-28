// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GitRepositorySnapshot } from '../../../contracts/ipc/v1/workspace.js';
import { GitPanel } from './GitPanel.js';

describe('GitPanel', () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it('loads repository changes and performs stage and commit actions', async () => {
    const snapshot: GitRepositorySnapshot = { root: '/workspace', repositoryName: 'workspace', branch: 'main', detached: false, upstream: 'origin/main', ahead: 1, behind: 0, clean: false, conflicts: 0, changes: [{ path: 'src/file.ts', status: 'modified', indexStatus: '.', worktreeStatus: 'M', staged: false, unstaged: true, binary: false }, { path: 'README.md', status: 'modified', indexStatus: '.', worktreeStatus: 'M', staged: false, unstaged: true, binary: false }, { path: '.lotagate/', status: 'untracked', indexStatus: '?', worktreeStatus: '?', staged: false, unstaged: true, binary: false, directory: true }], exitCode: 0, stderr: '', updatedAt: new Date().toISOString() };
    let currentSnapshot = snapshot;
    const stageAll = vi.fn().mockImplementation(() => { currentSnapshot = { ...currentSnapshot, changes: currentSnapshot.changes.map(change => ({ ...change, staged: true, unstaged: false, indexStatus: 'M', worktreeStatus: '.' })) }; return Promise.resolve(); });
    const stage = vi.fn().mockImplementation((_cwd: string, path: string) => { currentSnapshot = { ...currentSnapshot, changes: currentSnapshot.changes.map(change => change.path === path ? { ...change, staged: true, unstaged: false, indexStatus: 'M', worktreeStatus: '.' } : change) }; return Promise.resolve(); });
    const commit = vi.fn().mockResolvedValue({ output: '[main abc123] update' });
    Object.defineProperty(window, 'lotagate', { configurable: true, value: { approvals: { request: vi.fn().mockResolvedValue({ approvalId: 'approval-1', approved: true }) }, agent: { onEvent: vi.fn(() => vi.fn()) }, git: { status: vi.fn().mockImplementation(() => Promise.resolve(currentSnapshot)), branchList: vi.fn().mockResolvedValue([{ name: 'main', current: true, remote: false, ahead: 1, behind: 0 }]), history: vi.fn().mockResolvedValue([]), stashList: vi.fn().mockResolvedValue([]), stageAll, stage, commit, unstage: vi.fn(), unstageAll: vi.fn(), restore: vi.fn(), fetch: vi.fn(), pull: vi.fn(), push: vi.fn(), createBranch: vi.fn(), checkout: vi.fn(), stashSave: vi.fn(), stashApply: vi.fn(), stashDrop: vi.fn() } } });
    render(<GitPanel cwd="/workspace" onClose={vi.fn()} />);
    expect(await screen.findByText('src/file.ts')).toBeVisible();
    expect(screen.getByText('workspace')).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'Commit message' })).toHaveClass('text-area');
    expect(screen.getByText('.lotagate/')).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('button', { name: 'Current Git branch' })).toHaveClass('model-select');
    fireEvent.click(screen.getByRole('button', { name: 'New branch' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Branch name' }), { target: { value: 'feature/git-panel' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create branch' }));
    await waitFor(() => expect(window.lotagate.git.createBranch).toHaveBeenCalledWith('/workspace', 'feature/git-panel'));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Pull' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Pull' }));
    await waitFor(() => expect(window.lotagate.git.pull).toHaveBeenCalledWith('/workspace'));
    fireEvent.click(screen.getAllByRole('button', { name: 'Stage' })[0]!);
    await waitFor(() => expect(stage).toHaveBeenCalledWith('/workspace', 'src/file.ts'));
    fireEvent.click(screen.getByRole('button', { name: 'Stage all' }));
    await waitFor(() => expect(stageAll).toHaveBeenCalledWith('/workspace'));
    fireEvent.change(screen.getByRole('textbox', { name: 'Commit message' }), { target: { value: 'Update file' } });
    expect(screen.getByRole('button', { name: /Commit/u })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: /Commit/u }));
    await waitFor(() => expect(commit).toHaveBeenCalledWith('/workspace', 'Update file'));
  });
});
