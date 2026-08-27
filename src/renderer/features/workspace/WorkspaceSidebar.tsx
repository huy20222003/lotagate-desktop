import { useEffect, useRef, type KeyboardEventHandler, type PointerEventHandler } from 'react';
import { ChevronDown, CirclePlus, Folder, PanelLeftClose, PanelLeftOpen, Pencil, Settings, ShieldCheck, X } from 'lucide-react';
import type { Task, Workspace } from '../../../contracts/ipc/v1/workspace.js';
import { Scrollbar } from '../../components/Scrollbar.js';
import { Avatar, Button, Icon, Skeleton } from '../../components/ui.js';
import { BrandLogo } from '../../components/BrandLogo.js';
import { SidebarLoadingSkeleton } from './SidebarLoadingSkeleton.js';
import { WorkspaceGroup } from './WorkspaceGroup.js';

export interface WorkspaceSidebarProps {
  accountName: string; avatarProps: { name: string; src?: string };
  workspaces: Workspace[]; activeWorkspace?: Workspace | undefined; tasks: Task[]; activeTask?: Task | undefined; loading: boolean;
  accountOpen: boolean; onAccount: () => void; onCloseAccount: () => void; onSettings: () => void; onLogout: () => void;
  onNewChat: (workspace?: Workspace) => void; onWorkspace: (workspace: Workspace) => void; onTask: (task: Task) => void; onAddWorkspace: () => void;
  onRenameWorkspace: (workspace: Workspace) => void; onRemoveWorkspace: (workspace: Workspace) => void; onArchiveTask: (task: Task) => void; onPinTask: (task: Task, pinned: boolean) => void; onRenameTask: (task: Task) => void; collapsed: boolean; onToggleCollapsed: () => void;
  sidebarResizing: boolean; onStartResize: PointerEventHandler<HTMLDivElement>; onResizeKeyDown: KeyboardEventHandler<HTMLDivElement>;
}

export function WorkspaceSidebar({ accountName, avatarProps, workspaces, activeWorkspace, tasks, activeTask, loading, accountOpen, onAccount, onCloseAccount, onSettings, onLogout, onNewChat, onWorkspace, onTask, onAddWorkspace, onRenameWorkspace, onRemoveWorkspace, onArchiveTask, onPinTask, onRenameTask, collapsed, onToggleCollapsed, sidebarResizing, onStartResize, onResizeKeyDown }: WorkspaceSidebarProps) {
  const accountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!accountOpen) return;
    const closeOnOutsideClick = (event: PointerEvent) => { if (!accountRef.current?.contains(event.target as Node)) onCloseAccount(); };
    document.addEventListener('pointerdown', closeOnOutsideClick);
    return () => document.removeEventListener('pointerdown', closeOnOutsideClick);
  }, [accountOpen, onCloseAccount]);

  const ToggleIcon = collapsed ? PanelLeftOpen : PanelLeftClose;
  return <aside className={`sidebar${sidebarResizing ? ' is-resizing' : ''}`}>
    <div className="sidebar-resize-handle" role="separator" aria-label="Resize sidebar" aria-orientation="vertical" tabIndex={0} onPointerDown={onStartResize} onKeyDown={onResizeKeyDown} />
    <header className="sidebar-header"><div className="brand-mark"><BrandLogo /><span>LotaGate</span></div><button type="button" className="icon-button ui-icon-button sidebar-toggle" aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} aria-expanded={!collapsed} onClick={onToggleCollapsed}><Icon icon={ToggleIcon} size={17} /></button></header>
    <Button variant="secondary" className="new-task" onClick={() => onNewChat(activeWorkspace)} disabled={activeWorkspace === undefined}><Icon icon={Pencil} size={16} /> New Chat</Button>
    <Scrollbar className="workspace-scrollbar sidebar-section">
      <div className="section-heading"><span>Workspaces</span><button className="icon-button ui-icon-button" aria-label="Add workspace" onClick={onAddWorkspace}><Icon icon={CirclePlus} size={14} /></button></div>
      {loading ? <SidebarLoadingSkeleton /> : workspaces.length === 0 ? <button className="workspace-row" onClick={onAddWorkspace}><Icon icon={Folder} size={15} /><span>Add a workspace</span></button> : workspaces.map(workspace => <WorkspaceGroup key={workspace.id} workspace={workspace} tasks={tasks.filter(task => task.workspaceId === workspace.id && !task.archived)} activeTask={activeTask} onWorkspace={onWorkspace} onTask={onTask} onNewChat={onNewChat} onRename={onRenameWorkspace} onRemove={onRemoveWorkspace} onArchive={onArchiveTask} onPin={onPinTask} onRenameTask={onRenameTask} />)}
    </Scrollbar>
    <div ref={accountRef} className="account-area">
      {loading ? <div className="account-loading"><Skeleton className="sidebar-avatar-skeleton" /><Skeleton className="sidebar-account-skeleton" /></div> : <button className="account-button" onClick={onAccount} aria-expanded={accountOpen}><Avatar {...avatarProps} /><span className="account-copy"><strong>{accountName}</strong></span><Icon icon={ChevronDown} size={14} className={`account-chevron ${accountOpen ? 'open' : ''}`} /></button>}
      {accountOpen ? <div className="account-menu"><button onClick={onSettings}><Icon icon={Settings} size={14} /> Settings</button><button><Icon icon={ShieldCheck} size={14} /> Connection status <span className="connected-dot" /></button><button className="danger-menu" onClick={onLogout}><Icon icon={X} size={14} /> Sign out</button></div> : null}
    </div>
  </aside>;
}
