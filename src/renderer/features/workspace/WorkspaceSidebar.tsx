import { useEffect, useRef, useState } from 'react';
import { Archive, ChevronDown, CirclePlus, Folder, PanelLeftClose, PanelLeftOpen, Pencil, Pin, PinOff, Plus, Settings, ShieldCheck, Trash2, X } from 'lucide-react';
import type { Task, Workspace } from '../../../contracts/ipc/v1/workspace.js';
import { Scrollbar } from '../../components/Scrollbar.js';
import { Avatar, Button, Icon, Skeleton } from '../../components/ui.js';
import { BrandLogo } from '../../components/BrandLogo.js';
import { sessionSlug } from './task-title.js';
import { ActionMenu } from '../../components/ActionMenu.js';

interface WorkspaceSidebarProps {
  accountName: string; avatarProps: { name: string; src?: string };
  workspaces: Workspace[]; activeWorkspace?: Workspace | undefined; tasks: Task[]; activeTask?: Task | undefined; loading: boolean;
  accountOpen: boolean; onAccount: () => void; onCloseAccount: () => void; onSettings: () => void; onLogout: () => void;
  onNewChat: (workspace?: Workspace) => void; onWorkspace: (workspace: Workspace) => void; onTask: (task: Task) => void; onAddWorkspace: () => void;
  onRenameWorkspace: (workspace: Workspace) => void; onRemoveWorkspace: (workspace: Workspace) => void; onArchiveTask: (task: Task) => void; onPinTask: (task: Task, pinned: boolean) => void; onRenameTask: (task: Task) => void; collapsed: boolean; onToggleCollapsed: () => void;
}

export function WorkspaceSidebar({ accountName, avatarProps, workspaces, activeWorkspace, tasks, activeTask, loading, accountOpen, onAccount, onCloseAccount, onSettings, onLogout, onNewChat, onWorkspace, onTask, onAddWorkspace, onRenameWorkspace, onRemoveWorkspace, onArchiveTask, onPinTask, onRenameTask, collapsed, onToggleCollapsed }: WorkspaceSidebarProps) {
  const accountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!accountOpen) return;
    const closeOnOutsideClick = (event: PointerEvent) => { if (!accountRef.current?.contains(event.target as Node)) onCloseAccount(); };
    document.addEventListener('pointerdown', closeOnOutsideClick);
    return () => document.removeEventListener('pointerdown', closeOnOutsideClick);
  }, [accountOpen, onCloseAccount]);

  const ToggleIcon = collapsed ? PanelLeftOpen : PanelLeftClose;
  return <aside className="sidebar">
    <header className="sidebar-header"><div className="brand-mark"><BrandLogo /><span>LotaGate</span></div><button type="button" className="icon-button ui-icon-button sidebar-toggle" aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} aria-expanded={!collapsed} onClick={onToggleCollapsed}><Icon icon={ToggleIcon} size={17} /></button></header>
    <Button variant="secondary" className="new-task" onClick={() => onNewChat(activeWorkspace)} disabled={activeWorkspace === undefined}><Icon icon={CirclePlus} size={16} /> New Chat</Button>
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

function WorkspaceGroup({ workspace, tasks, activeTask, onWorkspace, onTask, onNewChat, onRename, onRemove, onArchive, onPin, onRenameTask }: { workspace: Workspace; tasks: Task[]; activeTask?: Task | undefined; onWorkspace: (workspace: Workspace) => void; onTask: (task: Task) => void; onNewChat: (workspace: Workspace) => void; onRename: (workspace: Workspace) => void; onRemove: (workspace: Workspace) => void; onArchive: (task: Task) => void; onPin: (task: Task, pinned: boolean) => void; onRenameTask: (task: Task) => void }) {
  const [showAllSessions, setShowAllSessions] = useState(false);
  const orderedTasks = [...tasks].sort((left, right) => Number(right.pinned) - Number(left.pinned) || right.updatedAt.localeCompare(left.updatedAt));
  const visibleTasks = showAllSessions ? orderedTasks : orderedTasks.slice(0, 5);
  const workspaceMenuHeader = <div className="action-menu-header-copy"><strong>{workspace.name}</strong><span>{tasks.length} chats · {tasks.filter(task => task.status === 'active').length} active</span><small>{workspace.rootPath}</small></div>;
  return <section className="workspace-group">
    <div className="workspace-row-shell"><button className="workspace-row" onClick={() => onWorkspace(workspace)}><Icon icon={Folder} size={15} /><span>{workspace.name}</span></button><button className="workspace-new-chat" aria-label={`New chat in ${workspace.name}`} onClick={() => onNewChat(workspace)}><Icon icon={Plus} size={14} /></button><ActionMenu className="workspace-details-button" ariaLabel={`Workspace actions for ${workspace.name}`} header={workspaceMenuHeader} items={[{ label: 'Rename workspace', icon: Pencil, onSelect: () => onRename(workspace) }, { label: 'Remove workspace', icon: Trash2, tone: 'danger', onSelect: () => onRemove(workspace) }]} /></div>
    <div className="session-list" aria-label={`${workspace.name} sessions`}>{visibleTasks.map(task => <div key={task.id} className={`session-row-shell ${activeTask?.id === task.id ? 'active' : ''}`}><button className="session-row" onClick={() => onTask(task)}><SessionTitle title={sessionSlug(task)} />{task.pinned ? <Pin className="session-pin" size={12} aria-label="Pinned session" /> : null}</button><ActionMenu ariaLabel={`Session actions for ${sessionSlug(task)}`} className="session-details-button" items={[{ label: task.pinned ? 'Unpin session' : 'Pin session', icon: task.pinned ? PinOff : Pin, onSelect: () => onPin(task, !task.pinned) }, { label: 'Rename', icon: Pencil, onSelect: () => onRenameTask(task) }, { label: 'Archive session', icon: Archive, tone: 'danger', onSelect: () => onArchive(task) }]} /></div>)}{tasks.length > 5 ? <button className="session-show-more" onClick={() => setShowAllSessions(current => !current)}>{showAllSessions ? 'Show less' : 'Show more'}</button> : null}{tasks.length === 0 ? <span className="sidebar-empty">No sessions yet</span> : null}</div>
  </section>;
}

function SidebarLoadingSkeleton() {
  return <div className="sidebar-loading-skeleton"><div className="workspace-skeleton-row"><Skeleton className="skeleton-icon" /><Skeleton className="skeleton-sidebar-line workspace-skeleton-line" /></div><Skeleton className="skeleton-sidebar-line session-skeleton-line" /><Skeleton className="skeleton-sidebar-line session-skeleton-line" /><Skeleton className="skeleton-sidebar-line session-skeleton-line" /></div>;
}

function SessionTitle({ title }: { title: string }) {
  const viewportRef = useRef<HTMLSpanElement>(null);
  const [overflowing, setOverflowing] = useState(false);
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const measure = () => setOverflowing(viewport.scrollWidth > viewport.clientWidth + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [title]);
  return <span ref={viewportRef} className={`session-title-viewport ${overflowing ? 'is-overflowing' : ''}`}><span className="session-title-track"><span>{title}</span>{overflowing ? <span aria-hidden="true">{title}</span> : null}</span></span>;
}
