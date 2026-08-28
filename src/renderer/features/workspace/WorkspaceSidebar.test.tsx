// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Workspace } from '../../../contracts/ipc/v1/workspace.js';
import { WorkspaceSidebar, type WorkspaceSidebarProps } from './WorkspaceSidebar.js';

describe('WorkspaceSidebar', () => {
  it('exposes Codex-style new chat and opens plugins from the sidebar', () => {
    const onNewChat = vi.fn();
    const onPlugins = vi.fn();
    const onAutomations = vi.fn();
    const props: WorkspaceSidebarProps = {
      accountName: 'Nguyễn Huy', avatarProps: { name: 'Nguyễn Huy' }, workspaces: [], activeWorkspace: { id: 'workspace', name: 'Workspace', rootPath: '/workspace' } as Workspace, tasks: [], loading: false,
      accountOpen: false, onAccount: vi.fn(), onCloseAccount: vi.fn(), onSettings: vi.fn(), onPlugins, onAutomations, onLogout: vi.fn(), onNewChat, onWorkspace: vi.fn(), onTask: vi.fn(), onAddWorkspace: vi.fn(), onRenameWorkspace: vi.fn(), onRemoveWorkspace: vi.fn(), onArchiveTask: vi.fn(), onPinTask: vi.fn(), onRenameTask: vi.fn(), collapsed: false, onToggleCollapsed: vi.fn(), sidebarResizing: false, onStartResize: vi.fn(), onResizeKeyDown: vi.fn(),
    };

    render(<WorkspaceSidebar {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'New chat' }));
    fireEvent.click(screen.getByRole('button', { name: 'Plugins' }));
    fireEvent.click(screen.getByRole('button', { name: 'Automations' }));

    expect(onNewChat).toHaveBeenCalledWith(props.activeWorkspace);
    expect(onPlugins).toHaveBeenCalledOnce();
    expect(onAutomations).toHaveBeenCalledOnce();
  });
});
