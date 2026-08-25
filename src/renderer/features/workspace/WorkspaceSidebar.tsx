import { createPortal } from 'react-dom';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Archive, ChevronDown, CirclePlus, Folder, MoreHorizontal, Pencil, Pin, PinOff, Plus, Settings, ShieldCheck, Trash2, X } from 'lucide-react';
import type { Task, Workspace } from '../../../contracts/ipc/v1/workspace.js';
import { Scrollbar } from '../../components/Scrollbar.js';
import { Avatar, Button, Icon, Skeleton } from '../../components/ui.js';
import { BrandLogo } from '../../components/BrandLogo.js';
import { sessionSlug } from './task-title.js';

interface WorkspaceSidebarProps {
  accountName: string; avatarProps: { name: string; src?: string };
  workspaces: Workspace[]; activeWorkspace?: Workspace | undefined; tasks: Task[]; activeTask?: Task | undefined; loading: boolean;
  accountOpen: boolean; onAccount: () => void; onCloseAccount: () => void; onSettings: () => void; onLogout: () => void;
  onNewChat: (workspace?: Workspace) => void; onWorkspace: (workspace: Workspace) => void; onTask: (task: Task) => void; onAddWorkspace: () => void;
  onRenameWorkspace: (workspace: Workspace) => void; onRemoveWorkspace: (workspace: Workspace) => void; onArchiveTask: (task: Task) => void; onPinTask: (task: Task, pinned: boolean) => void;
}

export function WorkspaceSidebar({ accountName, avatarProps, workspaces, activeWorkspace, tasks, activeTask, loading, accountOpen, onAccount, onCloseAccount, onSettings, onLogout, onNewChat, onWorkspace, onTask, onAddWorkspace, onRenameWorkspace, onRemoveWorkspace, onArchiveTask, onPinTask }: WorkspaceSidebarProps) {
  const accountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!accountOpen) return;
    const closeOnOutsideClick = (event: PointerEvent) => { if (!accountRef.current?.contains(event.target as Node)) onCloseAccount(); };
    document.addEventListener('pointerdown', closeOnOutsideClick);
    return () => document.removeEventListener('pointerdown', closeOnOutsideClick);
  }, [accountOpen, onCloseAccount]);

  return <aside className="sidebar">
    <header className="sidebar-header"><div className="brand-mark"><BrandLogo /><span>LotaGate</span></div></header>
    <Button variant="secondary" className="new-task" onClick={() => onNewChat(activeWorkspace)} disabled={activeWorkspace === undefined}><Icon icon={CirclePlus} size={16} /> New Chat</Button>
    <Scrollbar className="workspace-scrollbar sidebar-section">
      <div className="section-heading"><span>Workspaces</span><button className="icon-button" aria-label="Add workspace" onClick={onAddWorkspace}><Icon icon={CirclePlus} size={14} /></button></div>
      {loading ? <SidebarLoadingSkeleton /> : workspaces.length === 0 ? <button className="workspace-row" onClick={onAddWorkspace}><Icon icon={Folder} size={15} /><span>Add a workspace</span></button> : workspaces.map(workspace => <WorkspaceGroup key={workspace.id} workspace={workspace} tasks={tasks.filter(task => task.workspaceId === workspace.id && !task.archived)} activeTask={activeTask} onWorkspace={onWorkspace} onTask={onTask} onNewChat={onNewChat} onRename={onRenameWorkspace} onRemove={onRemoveWorkspace} onArchive={onArchiveTask} onPin={onPinTask} />)}
    </Scrollbar>
    <div ref={accountRef} className="account-area">
      {loading ? <div className="account-loading"><Skeleton className="sidebar-avatar-skeleton" /><Skeleton className="sidebar-account-skeleton" /></div> : <button className="account-button" onClick={onAccount} aria-expanded={accountOpen}><Avatar {...avatarProps} /><span className="account-copy"><strong>{accountName}</strong></span><Icon icon={ChevronDown} size={14} className={`account-chevron ${accountOpen ? 'open' : ''}`} /></button>}
      {accountOpen ? <div className="account-menu"><button onClick={onSettings}><Icon icon={Settings} size={14} /> Settings</button><button><Icon icon={ShieldCheck} size={14} /> Connection status <span className="connected-dot" /></button><button className="danger-menu" onClick={onLogout}><Icon icon={X} size={14} /> Sign out</button></div> : null}
    </div>
  </aside>;
}

function WorkspaceGroup({ workspace, tasks, activeTask, onWorkspace, onTask, onNewChat, onRename, onRemove, onArchive, onPin }: { workspace: Workspace; tasks: Task[]; activeTask?: Task | undefined; onWorkspace: (workspace: Workspace) => void; onTask: (task: Task) => void; onNewChat: (workspace: Workspace) => void; onRename: (workspace: Workspace) => void; onRemove: (workspace: Workspace) => void; onArchive: (task: Task) => void; onPin: (task: Task, pinned: boolean) => void }) {
  const rowRef = useRef<HTMLButtonElement>(null);
  const closeTimer = useRef<number | undefined>();
  const [infoOpen, setInfoOpen] = useState(false);
  const [sessionMenu, setSessionMenu] = useState<{ task: Task; top: number; left: number } | undefined>();
  const sessionMenuRef = useRef<HTMLDivElement>(null);
  const [showAllSessions, setShowAllSessions] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const updatePosition = useCallback(() => {
    const row = rowRef.current?.getBoundingClientRect();
    if (row) setPosition({ top: row.top, left: row.right + 8 });
  }, []);
  const openInfo = useCallback(() => { if (closeTimer.current !== undefined) window.clearTimeout(closeTimer.current); updatePosition(); setInfoOpen(true); }, [updatePosition]);
  const scheduleClose = useCallback(() => { closeTimer.current = window.setTimeout(() => setInfoOpen(false), 140); }, []);
  useEffect(() => () => { if (closeTimer.current !== undefined) window.clearTimeout(closeTimer.current); }, []);
  useEffect(() => { if (!infoOpen) return; window.addEventListener('resize', updatePosition); window.addEventListener('scroll', updatePosition, true); return () => { window.removeEventListener('resize', updatePosition); window.removeEventListener('scroll', updatePosition, true); }; }, [infoOpen, updatePosition]);
  useEffect(() => {
    if (!sessionMenu) return;
    const closeOnOutsideClick = (event: PointerEvent) => { if (!sessionMenuRef.current?.contains(event.target as Node)) setSessionMenu(undefined); };
    document.addEventListener('pointerdown', closeOnOutsideClick);
    return () => document.removeEventListener('pointerdown', closeOnOutsideClick);
  }, [sessionMenu]);
  const infoCard = infoOpen ? createPortal(<div className="workspace-info-card" style={{ top: position.top, left: position.left }} onMouseEnter={openInfo} onMouseLeave={scheduleClose}><strong>{workspace.name}</strong><span>{tasks.length} chats · {tasks.filter(task => task.status === 'active').length} active</span><small>{workspace.rootPath}</small><div className="workspace-popover-actions"><button onClick={() => onRename(workspace)}><Pencil size={13} /> Edit workspace</button><button className="workspace-popover-danger" onClick={() => onRemove(workspace)}><Trash2 size={13} /> Remove workspace</button></div></div>, document.body) : null;
  const sessionCard = sessionMenu ? createPortal(<div ref={sessionMenuRef} className="session-info-card" style={{ top: sessionMenu.top, left: sessionMenu.left }}><strong>{sessionSlug(sessionMenu.task)}</strong><div className="session-popover-actions"><button onClick={() => { const target = sessionMenu.task; setSessionMenu(undefined); onPin(target, !target.pinned); }}>{sessionMenu.task.pinned ? <PinOff size={13} /> : <Pin size={13} />} {sessionMenu.task.pinned ? 'Unpin session' : 'Pin session'}</button><button className="session-popover-danger" onClick={() => { const target = sessionMenu.task; setSessionMenu(undefined); onArchive(target); }}><Archive size={13} /> Archive session</button></div></div>, document.body) : null;
  const orderedTasks = [...tasks].sort((left, right) => Number(right.pinned) - Number(left.pinned) || right.updatedAt.localeCompare(left.updatedAt));
  const visibleTasks = showAllSessions ? orderedTasks : orderedTasks.slice(0, 5);
  return <section className="workspace-group">
    <div className="workspace-row-shell"><button ref={rowRef} className="workspace-row" onClick={() => onWorkspace(workspace)}><Icon icon={Folder} size={15} /><span>{workspace.name}</span></button><button className="workspace-new-chat" aria-label={`New chat in ${workspace.name}`} onClick={() => onNewChat(workspace)}><Icon icon={Plus} size={14} /></button><button className="workspace-details-button" aria-label={`Workspace actions for ${workspace.name}`} aria-expanded={infoOpen} onClick={openInfo}><Icon icon={MoreHorizontal} size={15} /></button></div>
    <div className="session-list" aria-label={`${workspace.name} sessions`}>{visibleTasks.map(task => <div key={task.id} className={`session-row-shell ${activeTask?.id === task.id ? 'active' : ''}`}><button className="session-row" onClick={() => onTask(task)}><SessionTitle title={sessionSlug(task)} />{task.pinned ? <Pin className="session-pin" size={12} aria-label="Pinned session" /> : null}</button><button className="session-details-button" aria-label={`Session actions for ${sessionSlug(task)}`} aria-expanded={sessionMenu?.task.id === task.id} onClick={event => { event.preventDefault(); event.stopPropagation(); const row = event.currentTarget.getBoundingClientRect(); setSessionMenu({ task, top: row.top, left: Math.max(8, row.right - 210) }); }}><MoreHorizontal size={15} /></button></div>)}{tasks.length > 5 ? <button className="session-show-more" onClick={() => setShowAllSessions(current => !current)}>{showAllSessions ? 'Show less' : 'Show more'}</button> : null}{tasks.length === 0 ? <span className="sidebar-empty">No sessions yet</span> : null}</div>
    {infoCard}{sessionCard}
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
