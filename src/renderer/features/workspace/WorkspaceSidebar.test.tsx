// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Task, Workspace } from '../../../contracts/ipc/v1/workspace.js';
import { WorkspaceSidebar, type WorkspaceSidebarProps } from './WorkspaceSidebar.js';

describe('WorkspaceSidebar', () => {
  it('exposes Codex-style new chat and opens plugins from the sidebar', () => {
    const onNewChat = vi.fn();
    const onPlugins = vi.fn();
    const onAutomations = vi.fn();
    const props: WorkspaceSidebarProps = {
      accountName: 'Nguyễn Huy', avatarProps: { name: 'Nguyễn Huy' }, workspaces: [], activeWorkspace: { id: 'workspace', name: 'Workspace', rootPath: '/workspace' } as Workspace, tasks: [], runningTaskIds: new Set(), unreadTaskIds: new Set(), loading: false,
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

  it('shows a spinner for running sessions and a dot for unread completed sessions', () => {
    Object.defineProperty(globalThis, 'ResizeObserver', { configurable: true, value: class { observe() {} disconnect() {} } });
    const workspace = { id: 'workspace', name: 'Workspace', rootPath: '/workspace' } as Workspace;
    const task = { id: 'task', workspaceId: workspace.id, title: 'Test session', cwd: workspace.rootPath, status: 'completed', pinned: false, archived: false, draft: '', draftAttachmentIds: [], lastEventCursor: 0, createdAt: '2026-08-30T00:00:00.000Z', updatedAt: '2026-08-30T00:00:00.000Z' } as Task;
    const props: WorkspaceSidebarProps = {
      accountName: 'Nguyễn Huy', avatarProps: { name: 'Nguyễn Huy' }, workspaces: [workspace], activeWorkspace: workspace, tasks: [task], activeTask: undefined, runningTaskIds: new Set([task.id]), unreadTaskIds: new Set(), loading: false,
      accountOpen: false, onAccount: vi.fn(), onCloseAccount: vi.fn(), onSettings: vi.fn(), onPlugins: vi.fn(), onAutomations: vi.fn(), onLogout: vi.fn(), onNewChat: vi.fn(), onWorkspace: vi.fn(), onTask: vi.fn(), onAddWorkspace: vi.fn(), onRenameWorkspace: vi.fn(), onRemoveWorkspace: vi.fn(), onArchiveTask: vi.fn(), onPinTask: vi.fn(), onRenameTask: vi.fn(), collapsed: false, onToggleCollapsed: vi.fn(), sidebarResizing: false, onStartResize: vi.fn(), onResizeKeyDown: vi.fn(),
    };

    const view = render(<WorkspaceSidebar {...props} />);
    expect(screen.getByRole('status', { name: 'Agent is responding' })).toBeInTheDocument();
    view.rerender(<WorkspaceSidebar {...props} runningTaskIds={new Set()} unreadTaskIds={new Set([task.id])} />);
    expect(screen.getByRole('status', { name: 'New agent message' })).toBeInTheDocument();
  });
});
