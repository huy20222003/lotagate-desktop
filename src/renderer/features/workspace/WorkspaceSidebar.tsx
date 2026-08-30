import { useEffect, useRef, type KeyboardEventHandler, type PointerEventHandler } from 'react';
import { Blocks, ChevronDown, CirclePlus, Clock3, Folder, PanelLeftClose, PanelLeftOpen, Pencil, Settings, X } from 'lucide-react';
import type { Task, Workspace } from '../../../contracts/ipc/v1/workspace.js';
import { Scrollbar } from '../../components/Scrollbar.js';
import { Avatar, Button, Icon, IconButton, Skeleton } from '../../components/ui.js';
import { BrandLogo } from '../../components/BrandLogo.js';
import { SidebarLoadingSkeleton } from './SidebarLoadingSkeleton.js';
import { WorkspaceGroup } from './WorkspaceGroup.js';

export interface WorkspaceSidebarProps {
  accountName: string; avatarProps: { name: string; src?: string };
  workspaces: Workspace[]; activeWorkspace?: Workspace | undefined; tasks: Task[]; activeTask?: Task | undefined; runningTaskIds: ReadonlySet<string>; unreadTaskIds: ReadonlySet<string>; loading: boolean;
  accountOpen: boolean; onAccount: () => void; onCloseAccount: () => void; onSettings: () => void; onPlugins: () => void; onAutomations: () => void; onLogout: () => void;
  onNewChat: (workspace?: Workspace) => void; onWorkspace: (workspace: Workspace) => void; onTask: (task: Task) => void; onAddWorkspace: () => void;
  onRenameWorkspace: (workspace: Workspace) => void; onRemoveWorkspace: (workspace: Workspace) => void; onArchiveTask: (task: Task) => void; onPinTask: (task: Task, pinned: boolean) => void; onRenameTask: (task: Task) => void; collapsed: boolean; onToggleCollapsed: () => void;
  sidebarResizing: boolean; onStartResize: PointerEventHandler<HTMLDivElement>; onResizeKeyDown: KeyboardEventHandler<HTMLDivElement>;
}

export function WorkspaceSidebar({ accountName, avatarProps, workspaces, activeWorkspace, tasks, activeTask, runningTaskIds, unreadTaskIds, loading, accountOpen, onAccount, onCloseAccount, onSettings, onPlugins, onAutomations, onLogout, onNewChat, onWorkspace, onTask, onAddWorkspace, onRenameWorkspace, onRemoveWorkspace, onArchiveTask, onPinTask, onRenameTask, collapsed, onToggleCollapsed, sidebarResizing, onStartResize, onResizeKeyDown }: WorkspaceSidebarProps) {
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
    <header className="sidebar-header"><div className="brand-mark"><BrandLogo /><span>LotaGate</span></div><IconButton icon={ToggleIcon} iconSize={17} className="sidebar-toggle" label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} aria-expanded={!collapsed} onClick={onToggleCollapsed} /></header>
    <Button variant="ghost" className="new-task sidebar-action" onClick={() => onNewChat(activeWorkspace)} disabled={activeWorkspace === undefined}><Icon icon={Pencil} size={16} /> New chat</Button>
    <Button variant="ghost" className="sidebar-plugin sidebar-action" onClick={onPlugins}><Icon icon={Blocks} size={16} /> Plugins</Button>
    <Button variant="ghost" className="sidebar-automation sidebar-action" onClick={onAutomations}><Icon icon={Clock3} size={16} /> Automations</Button>
    <Scrollbar className="workspace-scrollbar sidebar-section scrollbar-hide-track">
      <div className="section-heading"><span>Workspaces</span><IconButton icon={CirclePlus} iconSize={14} label="Add workspace" onClick={onAddWorkspace} /></div>
      {loading ? <SidebarLoadingSkeleton /> : workspaces.length === 0 ? <button className="workspace-row" onClick={onAddWorkspace}><Icon icon={Folder} size={15} /><span>Add a workspace</span></button> : workspaces.map(workspace => <WorkspaceGroup key={workspace.id} workspace={workspace} tasks={tasks.filter(task => task.workspaceId === workspace.id && !task.archived)} activeTask={activeTask} runningTaskIds={runningTaskIds} unreadTaskIds={unreadTaskIds} onWorkspace={onWorkspace} onTask={onTask} onNewChat={onNewChat} onRename={onRenameWorkspace} onRemove={onRemoveWorkspace} onArchive={onArchiveTask} onPin={onPinTask} onRenameTask={onRenameTask} />)}
    </Scrollbar>
    <div ref={accountRef} className="account-area">
      {loading ? <div className="account-loading"><Skeleton className="sidebar-avatar-skeleton" /><Skeleton className="sidebar-account-skeleton" /></div> : <button className="account-button" onClick={onAccount} aria-expanded={accountOpen}><Avatar {...avatarProps} /><span className="account-copy"><strong>{accountName}</strong></span><Icon icon={ChevronDown} size={14} className={`account-chevron ${accountOpen ? 'open' : ''}`} /></button>}
      {accountOpen ? <div className="account-menu"><button onClick={onSettings}><Icon icon={Settings} size={14} /> Settings</button><button className="danger-menu" onClick={onLogout}><Icon icon={X} size={14} /> Sign out</button></div> : null}
    </div>
  </aside>;
}
