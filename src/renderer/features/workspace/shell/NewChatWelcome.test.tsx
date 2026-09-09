// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GitBranch, Workspace } from '../../../../contracts/ipc/v1/workspace.js';
import { NewChatWelcome } from './NewChatWelcome.js';

describe('NewChatWelcome', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders workspace name and git branch when available', async () => {
    const branchList = vi.fn().mockResolvedValue([
      { name: 'main', current: true, remote: false, ahead: 0, behind: 0 } as GitBranch,
      { name: 'feature/test', current: false, remote: false, ahead: 0, behind: 0 } as GitBranch,
    ]);
    Object.defineProperty(window, 'lotagate', {
      configurable: true,
      value: {
        git: { branchList },
      },
    });

    const workspace = {
      id: 'ws-1',
      name: 'lota-gate',
      rootPath: '/projects/lota-gate',
      trusted: true,
      lastOpenedAt: '2026-09-08T00:00:00.000Z',
    } as Workspace;

    render(
      <NewChatWelcome workspace={workspace}>
        <div data-testid="composer-child">Composer</div>
      </NewChatWelcome>
    );

    expect(screen.getByText('LotaGate Agent')).toBeInTheDocument();
    expect(screen.getByText('lota-gate')).toBeInTheDocument();
    expect(screen.getByTestId('composer-child')).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText('main')).toBeInTheDocument();
    });
    expect(branchList).toHaveBeenCalledWith('/projects/lota-gate');
  });

  it('renders only workspace name when git branch lookup fails or repository is non-git', async () => {
    const branchList = vi.fn().mockRejectedValue(new Error('Not a git repository'));
    Object.defineProperty(window, 'lotagate', {
      configurable: true,
      value: {
        git: { branchList },
      },
    });

    const workspace = {
      id: 'ws-2',
      name: 'simple-project',
      rootPath: '/projects/simple',
      trusted: true,
      lastOpenedAt: '2026-09-08T00:00:00.000Z',
    } as Workspace;

    render(
      <NewChatWelcome workspace={workspace}>
        <div data-testid="composer-child">Composer</div>
      </NewChatWelcome>
    );

    expect(screen.getByText('simple-project')).toBeInTheDocument();
    await waitFor(() => {
      expect(branchList).toHaveBeenCalledWith('/projects/simple');
    });
    expect(screen.queryByText('main')).not.toBeInTheDocument();
  });

  it('renders without context bar when workspace is undefined', () => {
    render(
      <NewChatWelcome>
        <div data-testid="composer-child">Composer</div>
      </NewChatWelcome>
    );

    expect(screen.getByText('LotaGate Agent')).toBeInTheDocument();
    expect(screen.getByTestId('composer-child')).toBeInTheDocument();
  });
});
