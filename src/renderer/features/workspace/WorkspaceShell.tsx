import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { WorkspaceSidebar } from './WorkspaceSidebar.js';
import { SettingsPage, type SettingsSection } from '../settings/SettingsPage.js';
import type { FileChangeSummary, Task, Workspace } from '../../../contracts/ipc/v1/workspace.js';
import type { UserProfile } from '../../../contracts/ipc/v1/auth.js';
import { Button, Field, Modal, TextInput, useToast } from '../../components/ui.js';
import { Scrollbar } from '../../components/Scrollbar.js';
import { useWorkspaceController } from './use-workspace-controller.js';
import type { AttachmentPreview } from './attachment-types.js';
import { OrchestrationPanel } from './OrchestrationPanel.js';
import { ImageLightbox } from './ImageLightbox.js';
import { ConversationTimeline } from './ConversationTimeline.js';
import { useKeyboardShortcuts } from '../../services/keyboard-shortcuts.js';
import { toUserErrorMessage as toMessage } from '../../utils/errors.js';
import { workspaceNameSchema } from '../../validation/shared.js';
import { FileChangesDrawer, GitPanel } from './WorkspaceOverlays.js';
import { Composer } from './Composer.js';
import { ConversationHeader } from './ConversationHeader.js';
import { ChatLoadingSkeleton } from './ChatLoadingSkeleton.js';
import { TaskConversation } from './TaskConversation.js';
import { ChangeSummaryChip } from './ChangeSummaryChip.js';
import { ScrollToLatestButton } from './ScrollToLatestButton.js';
import { NewChatWelcome } from './NewChatWelcome.js';
import { TerminalPanel } from './TerminalPanel.js';
import { SourcesDrawer } from './SourcesDrawer.js';
import { BrowserPanel } from './BrowserPanel.js';
import { useResizableSidePanel } from './use-resizable-panel.js';

export function WorkspaceShell({ user, onLoggedOut }: { user: UserProfile; onLoggedOut: () => void }) {
  const controller = useWorkspaceController();
  const { newTask, addWorkspace } = controller;
  const { success, error: showError } = useToast();
  const [accountOpen, setAccountOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<SettingsSection>('profile');
  const [logoutOpen, setLogoutOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<Workspace | undefined>();
  const [renameSessionTarget, setRenameSessionTarget] = useState<Task | undefined>();
  const [removeTarget, setRemoveTarget] = useState<Workspace | undefined>();
  const [archiveTarget, setArchiveTarget] = useState<Task | undefined>();
  const [pendingWorkspacePath, setPendingWorkspacePath] = useState<string | undefined>();
  const [workspaceName, setWorkspaceName] = useState('');
  const [sessionName, setSessionName] = useState('');
  const [workspaceActionBusy, setWorkspaceActionBusy] = useState(false);
  const [changesOpen, setChangesOpen] = useState(false);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [browserOpen, setBrowserOpen] = useState(false);
  const [gitOpen, setGitOpen] = useState(false);
  const [agentBrowserSessionId, setAgentBrowserSessionId] = useState<string>();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const { panelWidth: sidebarWidth, resizing: sidebarResizing, startResize: startSidebarResize, handleResizeKeyDown: handleSidebarResizeKeyDown } = useResizableSidePanel({ side: 'left', initialWidth: 290, minWidth: 220, maxWidth: 420 });
  const [changesSummary, setChangesSummary] = useState<FileChangeSummary | undefined>();
  const [lightboxImage, setLightboxImage] = useState<AttachmentPreview | undefined>();
  const threadViewportRef = useRef<HTMLDivElement>(null);
  const prependScrollRef = useRef<{ top: number; height: number }>();
  const hasRenderedActivities = useRef(false);
  const followLatestRef = useRef(true);
  const [showScrollBottom, setShowScrollBottom] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const openWorkspacePicker = useCallback(async () => {
    try {
      const rootPath = await window.lotagate.workspaces.pickFolder();
      if (!rootPath) return;
      setPendingWorkspacePath(rootPath);
    } catch (reason) { showError('Unable to add workspace', toMessage(reason)); }
  }, [addWorkspace, showError, success]);
  const confirmAddWorkspace = useCallback(async () => {
    if (!pendingWorkspacePath) return;
    setWorkspaceActionBusy(true);
    try { const added = await addWorkspace(pendingWorkspacePath); await controller.trustWorkspace(added.id, true); success('Workspace added', pendingWorkspacePath); setPendingWorkspacePath(undefined); }
    catch (reason) { showError('Unable to add workspace', toMessage(reason)); }
    finally { setWorkspaceActionBusy(false); }
  }, [addWorkspace, controller, pendingWorkspacePath, showError, success]);
  const startNewChat = useCallback(async (targetWorkspace?: Workspace) => {
    try { await newTask(targetWorkspace); success('New chat ready'); }
    catch (reason) { showError('Unable to start new chat', toMessage(reason)); }
  }, [newTask, showError, success]);
  const keyboardShortcuts = useKeyboardShortcuts({
    newSession: () => { void startNewChat(); },
    openWorkspace: () => { void openWorkspacePicker(); },
    openSettings: () => { setSettingsOpen(true); setAccountOpen(false); },
    focusPrompt: () => window.dispatchEvent(new Event('lotagate.focusPrompt')),
    archiveSession: () => { if (controller.task) setArchiveTarget(controller.task); },
    cancelResponse: () => { if (controller.thinking) void controller.cancelTask(); },
    toggleChangedFiles: () => { if (controller.fileChanges.files.length > 0) { setChangesSummary(controller.fileChanges); setChangesOpen(open => !open); } },
  });
  const startRename = useCallback((target: Workspace) => { setWorkspaceName(target.name); setRenameTarget(target); }, []);
  const workspaceNameValidation = workspaceNameSchema.safeParse(workspaceName);
  const workspaceNameError = workspaceNameValidation.success ? undefined : workspaceNameValidation.error.issues[0]?.message;
  const saveWorkspaceName = useCallback(async () => {
    if (!renameTarget || workspaceNameError !== undefined) return;
    setWorkspaceActionBusy(true);
    try { await controller.renameWorkspace(renameTarget.id, workspaceName.trim()); success('Workspace renamed'); setRenameTarget(undefined); }
    catch (reason) { showError('Unable to rename workspace', toMessage(reason)); }
    finally { setWorkspaceActionBusy(false); }
  }, [controller, renameTarget, showError, success, workspaceName, workspaceNameError]);
  const startRenameTask = useCallback((target: Task) => { setSessionName(target.title); setRenameSessionTarget(target); }, []);
  const sessionNameValidation = workspaceNameSchema.safeParse(sessionName);
  const sessionNameError = sessionNameValidation.success ? undefined : sessionNameValidation.error.issues[0]?.message;
  const saveSessionName = useCallback(async () => {
    if (!renameSessionTarget || sessionNameError !== undefined) return;
    setWorkspaceActionBusy(true);
    try { await controller.renameTask(renameSessionTarget.id, sessionName.trim()); success('Session renamed'); setRenameSessionTarget(undefined); }
    catch (reason) { showError('Unable to rename session', toMessage(reason)); }
    finally { setWorkspaceActionBusy(false); }
  }, [controller, renameSessionTarget, sessionName, sessionNameError, showError, success]);
  const startRemove = useCallback((target: Workspace) => setRemoveTarget(target), []);
  const confirmRemove = useCallback(async () => {
    if (!removeTarget) return;
    setWorkspaceActionBusy(true);
    try { await controller.removeWorkspace(removeTarget.id); success('Workspace removed'); setRemoveTarget(undefined); }
    catch (reason) { showError('Unable to remove workspace', toMessage(reason)); }
    finally { setWorkspaceActionBusy(false); }
  }, [controller, removeTarget, showError, success]);
  const confirmArchive = useCallback(async () => {
    if (!archiveTarget) return;
    setWorkspaceActionBusy(true);
    try { await controller.archiveTask(archiveTarget.id, true); success('Session archived'); setArchiveTarget(undefined); }
    catch (reason) { showError('Unable to archive session', toMessage(reason)); }
    finally { setWorkspaceActionBusy(false); }
  }, [archiveTarget, controller, showError, success]);
  useEffect(() => window.lotagate.menu.onCommand(command => {
    if (command === 'newTask') void startNewChat();
    if (command === 'openWorkspace') void openWorkspacePicker();
  }), [openWorkspacePicker, startNewChat]);
  useEffect(() => window.lotagate.agent.onEvent(envelope => {
    if (envelope.cwd !== controller.workspace?.rootPath) return;
    if (!envelope.event.event.startsWith('browser.')) return;
    const browserSessionId = envelope.event.data['browserSessionId'];
    if (typeof browserSessionId !== 'string') return;
    setAgentBrowserSessionId(browserSessionId);
    setChangesOpen(false);
    setSourcesOpen(false);
    setGitOpen(false);
    setBrowserOpen(true);
  }), [controller.workspace?.rootPath]);
  useEffect(() => {
    if (settingsOpen) return;
    const viewport = threadViewportRef.current;
    if (!viewport) return;
    const updateScrollState = () => {
      const atBottom = isViewportAtBottom(viewport);
      followLatestRef.current = atBottom;
      setShowScrollBottom(!atBottom);
      if (hasRenderedActivities.current && viewport.scrollTop <= 32 && controller.hasOlderActivities && !controller.loadingOlderActivities && prependScrollRef.current === undefined) {
        prependScrollRef.current = { top: viewport.scrollTop, height: viewport.scrollHeight };
        void controller.loadOlderActivities().then(loaded => { if (!loaded) prependScrollRef.current = undefined; }).catch(reason => { prependScrollRef.current = undefined; showError('Unable to load older messages', toMessage(reason)); });
      }
    };
    updateScrollState();
    viewport.addEventListener('scroll', updateScrollState, { passive: true });
    return () => viewport.removeEventListener('scroll', updateScrollState);
  }, [controller.hasOlderActivities, controller.loadOlderActivities, controller.loadingOlderActivities, settingsOpen, showError]);
  useLayoutEffect(() => {
    const pending = prependScrollRef.current;
    const viewport = threadViewportRef.current;
    if (!pending || !viewport) return;
    viewport.scrollTop = pending.top + Math.max(0, viewport.scrollHeight - pending.height);
    prependScrollRef.current = undefined;
  }, [controller.activities]);
  useEffect(() => {
    if (settingsOpen) return;
    followLatestRef.current = true;
    hasRenderedActivities.current = false;
    prependScrollRef.current = undefined;
    setShowScrollBottom(false);
    let secondFrame: number | undefined;
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        const viewport = threadViewportRef.current;
        viewport?.scrollTo({ top: viewport.scrollHeight, behavior: 'auto' });
      });
    });
    return () => {
      window.cancelAnimationFrame(firstFrame);
      if (secondFrame !== undefined) window.cancelAnimationFrame(secondFrame);
    };
  }, [controller.task?.id, settingsOpen]);
  useEffect(() => {
    const viewport = threadViewportRef.current;
    const latest = controller.activities[controller.activities.length - 1];
    if (latest?.kind === 'user') followLatestRef.current = true;
    if (!viewport || (!followLatestRef.current && hasRenderedActivities.current)) return;
    const behavior = !hasRenderedActivities.current || latest?.kind === 'user' || controller.thinking ? 'auto' : 'smooth';
    hasRenderedActivities.current = true;
    window.requestAnimationFrame(() => viewport.scrollTo({ top: viewport.scrollHeight, behavior }));
  }, [controller.activities, controller.agentStatus, controller.thinking]);
  const scrollToBottom = useCallback(() => {
    const viewport = threadViewportRef.current;
    if (!viewport) return;
    followLatestRef.current = true;
    setShowScrollBottom(false);
    viewport.scrollTo({ top: viewport.scrollHeight, behavior: 'smooth' });
    let frames = 0;
    const syncAfterScroll = () => {
      if (isViewportAtBottom(viewport) || frames++ >= 240) {
        setShowScrollBottom(!isViewportAtBottom(viewport));
        return;
      }
      window.requestAnimationFrame(syncAfterScroll);
    };
    window.requestAnimationFrame(syncAfterScroll);
  }, []);
  async function confirmLogout() { setLoggingOut(true); try { await window.lotagate.auth.logout(); onLoggedOut(); } finally { setLoggingOut(false); setLogoutOpen(false); } }
  const accountName = user.fullName ?? user.username ?? user.email;
  const avatarProps = user.avatarUrl ? { name: accountName, src: user.avatarUrl } : { name: accountName };
  const openChanges = useCallback((summary: FileChangeSummary) => { setChangesSummary(summary); setSourcesOpen(false); setBrowserOpen(false); setGitOpen(false); setChangesOpen(true); }, []);
  const latestFileChanges = controller.fileChanges.files.length > 0 ? controller.fileChanges : [...Object.values(controller.fileChangesByTurn)].reverse().find(summary => summary.files.length > 0) ?? controller.fileChanges;
  const toggleFileChanges = useCallback(() => { if (changesOpen) { setChangesOpen(false); return; } setChangesSummary(latestFileChanges); setSourcesOpen(false); setBrowserOpen(false); setGitOpen(false); setChangesOpen(true); }, [changesOpen, latestFileChanges]);
  const toggleSources = useCallback(() => { if (sourcesOpen) { setSourcesOpen(false); return; } setChangesOpen(false); setBrowserOpen(false); setGitOpen(false); setSourcesOpen(true); }, [sourcesOpen]);
  const toggleGit = useCallback(() => { if (gitOpen) { setGitOpen(false); return; } setChangesOpen(false); setSourcesOpen(false); setBrowserOpen(false); setGitOpen(true); }, [gitOpen]);
  const showConversationControls = showScrollBottom || (controller.thinking && controller.fileChanges.files.length > 0);
  const isWelcomeState = controller.task !== undefined && controller.workspace !== undefined && !controller.loading && !controller.activitiesLoading && !controller.thinking && !controller.activities.some(activity => activity.kind === 'user');
  useEffect(() => { setChangesSummary(undefined); setAgentBrowserSessionId(undefined); setBrowserOpen(false); setGitOpen(false); }, [controller.task?.id]);
  const scrollToMessage = useCallback((activityId: string) => { document.getElementById(`chat-message-${activityId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, []);
  if (settingsOpen) return <SettingsPage user={user} {...(controller.workspace === undefined ? {} : { workspace: controller.workspace })} workspaces={controller.workspaces} keyboardShortcuts={keyboardShortcuts.bindings} onUpdateShortcut={keyboardShortcuts.updateShortcut} initialSection={settingsSection} onBack={() => setSettingsOpen(false)} />;
  const composer = <Composer disabled={controller.workspace === undefined} workspace={controller.workspace} thinking={controller.thinking} task={controller.task} attachments={controller.attachments} queuedMessages={controller.queuedMessages} models={controller.models} selectedModel={controller.selectedModel} onModel={controller.setSelectedModel} busy={controller.busy} error={controller.error} onSend={controller.sendPrompt} onRunCommand={controller.runCommand} onCancel={controller.cancelTask} onDraft={controller.updateDraft} onAttach={controller.pickArtifact} onAttachImage={controller.attachImage} onRemoveAttachment={controller.removeAttachment} onSteerQueued={controller.steerQueuedMessage} onRemoveQueued={controller.removeQueuedMessage} onEditQueued={controller.editQueuedMessage} onOpenImage={setLightboxImage} approval={controller.approval} approvalMode={controller.approvalMode} onApprovalMode={controller.setApprovalMode} onApproval={controller.respondApproval} />;
  return <div className={`workspace-shell${sidebarCollapsed ? ' sidebar-collapsed' : ''}`} style={{ gridTemplateColumns: sidebarCollapsed ? '64px minmax(0, 1fr)' : `${sidebarWidth}px minmax(0, 1fr)` }}>
     <WorkspaceSidebar accountName={accountName} avatarProps={avatarProps} workspaces={controller.workspaces} activeWorkspace={controller.workspace} tasks={controller.tasks} activeTask={controller.task} loading={controller.loading} accountOpen={accountOpen} onAccount={() => setAccountOpen(open => !open)} onCloseAccount={() => setAccountOpen(false)} onSettings={() => { setSettingsSection('profile'); setSettingsOpen(true); setAccountOpen(false); }} onPlugins={() => { setSettingsSection('plugin'); setSettingsOpen(true); setAccountOpen(false); }} onAutomations={() => { setSettingsSection('automation'); setSettingsOpen(true); setAccountOpen(false); }} onLogout={() => { setLogoutOpen(true); setAccountOpen(false); }} onNewChat={startNewChat} onWorkspace={controller.selectWorkspace} onTask={controller.selectTask} onAddWorkspace={() => void openWorkspacePicker()} onRenameWorkspace={startRename} onRemoveWorkspace={startRemove} onArchiveTask={setArchiveTarget} onPinTask={(target, pinned) => { void controller.pinTaskById(target.id, pinned).catch(reason => showError('Unable to update session pin', toMessage(reason))); }} onRenameTask={startRenameTask} collapsed={sidebarCollapsed} onToggleCollapsed={() => setSidebarCollapsed(current => !current)} sidebarResizing={sidebarResizing} onStartResize={startSidebarResize} onResizeKeyDown={handleSidebarResizeKeyDown} />
    <main className={`conversation${changesOpen ? ' has-file-changes' : ''}${browserOpen ? ' has-browser' : ''}${gitOpen ? ' has-git' : ''}${isWelcomeState ? ' is-welcome' : ''}`}>
       {isWelcomeState ? null : <ConversationHeader task={controller.task} workspace={controller.workspace} changesOpen={changesOpen} sourcesOpen={sourcesOpen} terminalOpen={terminalOpen} gitOpen={gitOpen} onToggleChanges={toggleFileChanges} onToggleSources={toggleSources} onToggleTerminal={() => setTerminalOpen(open => !open)} onToggleGit={toggleGit} onRenameTask={startRenameTask} onPinTask={(pinned) => { if (controller.task) void controller.pinTaskById(controller.task.id, pinned).catch(reason => showError('Unable to update session pin', toMessage(reason))); }} onArchiveTask={() => { if (controller.task) setArchiveTarget(controller.task); }} />}
       <div className="conversation-columns">
         <section className="conversation-chat">
            {isWelcomeState ? <NewChatWelcome><div className="composer-dock">{composer}</div></NewChatWelcome> : <><div className="conversation-body"><ConversationTimeline activities={controller.activities} onSelect={scrollToMessage} viewportRef={threadViewportRef} /><Scrollbar className={`thread-scrollbar${controller.thinking ? ' is-thinking' : ''}`} viewportRef={threadViewportRef}><div className="thread-content">{controller.loading || controller.activitiesLoading ? <ChatLoadingSkeleton /> : <TaskConversation task={controller.task} activities={controller.activities} activityAttachments={controller.activityAttachments} fileChangesByTurn={controller.fileChangesByTurn} onOpenFileChanges={openChanges} onOpenImage={setLightboxImage} statusText={controller.agentStatus} contextCompactionStatus={controller.contextCompactionStatus} plan={controller.plan} thinking={controller.thinking} {...(controller.thinkingStartedAt === undefined ? {} : { thinkingStartedAt: controller.thinkingStartedAt })} turnTimings={controller.turnTimings} trust={controller.trust} onTrust={controller.respondTrust} />}</div></Scrollbar></div><OrchestrationPanel plan={controller.plan} subagents={controller.subagents} /><div className="composer-dock">{showConversationControls ? <div className="conversation-controls">{showScrollBottom ? <ScrollToLatestButton thinking={controller.thinking} awayFromLatest={showScrollBottom} onClick={scrollToBottom} /> : null}{controller.thinking && controller.fileChanges.files.length > 0 ? <ChangeSummaryChip summary={controller.fileChanges} onClick={() => openChanges(controller.fileChanges)} /> : null}</div> : null}{composer}</div>{terminalOpen && controller.workspace ? <TerminalPanel cwd={controller.workspace.rootPath} onClose={() => setTerminalOpen(false)} /> : null}</>}
         </section>
         {!isWelcomeState && changesOpen && controller.workspace ? <FileChangesDrawer cwd={controller.workspace.rootPath} summary={changesSummary ?? controller.fileChanges} onClose={() => setChangesOpen(false)} /> : null}
         {!isWelcomeState && sourcesOpen && controller.task ? <SourcesDrawer taskId={controller.task.id} refreshKey={controller.task.updatedAt} onClose={() => setSourcesOpen(false)} /> : null}
         {!isWelcomeState && browserOpen ? <BrowserPanel {...(controller.task?.id === undefined ? {} : { taskId: controller.task.id })} {...(agentBrowserSessionId === undefined ? {} : { sessionId: agentBrowserSessionId })} {...(controller.workspace?.rootPath === undefined ? {} : { cwd: controller.workspace.rootPath })} onClose={() => setBrowserOpen(false)} /> : null}
         {!isWelcomeState && gitOpen && controller.workspace ? <GitPanel cwd={controller.workspace.rootPath} onClose={() => setGitOpen(false)} /> : null}
      </div>
    </main>
    {logoutOpen ? <Modal title="Sign out of LotaGate" onClose={() => setLogoutOpen(false)}><p className="modal-copy">Your server session will be cleared. Local task records remain available.</p><div className="modal-actions"><Button variant="secondary" onClick={() => setLogoutOpen(false)}>Cancel</Button><Button variant="danger" onClick={confirmLogout} disabled={loggingOut}>{loggingOut ? 'Signing out…' : 'Sign out'}</Button></div></Modal> : null}
    {renameTarget ? <Modal title="Edit workspace" onClose={() => setRenameTarget(undefined)}><div className="modal-form"><Field label="Display name" required error={workspaceNameError}><TextInput value={workspaceName} onChange={event => setWorkspaceName(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') void saveWorkspaceName(); }} autoFocus /></Field></div><div className="modal-actions"><Button variant="secondary" onClick={() => setRenameTarget(undefined)}>Cancel</Button><Button variant="primary" onClick={() => void saveWorkspaceName()} disabled={workspaceActionBusy || workspaceNameError !== undefined}>{workspaceActionBusy ? 'Saving…' : 'Save'}</Button></div></Modal> : null}
    {renameSessionTarget ? <Modal title="Rename session" onClose={() => setRenameSessionTarget(undefined)}><div className="modal-form"><Field label="Session name" required error={sessionNameError}><TextInput value={sessionName} onChange={event => setSessionName(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') void saveSessionName(); }} autoFocus /></Field></div><div className="modal-actions"><Button variant="secondary" onClick={() => setRenameSessionTarget(undefined)}>Cancel</Button><Button variant="primary" onClick={() => void saveSessionName()} disabled={workspaceActionBusy || sessionNameError !== undefined}>{workspaceActionBusy ? 'Saving…' : 'Save'}</Button></div></Modal> : null}
    {removeTarget ? <Modal title="Remove workspace" onClose={() => setRemoveTarget(undefined)}><p className="modal-copy">Are you want to remove <strong>{removeTarget.name}</strong> workspace?</p><div className="modal-actions"><Button variant="secondary" onClick={() => setRemoveTarget(undefined)}>Cancel</Button><Button variant="danger" onClick={() => void confirmRemove()} disabled={workspaceActionBusy}>{workspaceActionBusy ? 'Removing…' : 'Remove workspace'}</Button></div></Modal> : null}
    {archiveTarget ? <Modal title="Archive session" onClose={() => setArchiveTarget(undefined)}><p className="modal-copy">Are you want to archive session <strong>{archiveTarget.title}</strong></p><div className="modal-actions"><Button variant="secondary" onClick={() => setArchiveTarget(undefined)}>Cancel</Button><Button variant="danger" onClick={() => void confirmArchive()} disabled={workspaceActionBusy}>{workspaceActionBusy ? 'Archiving…' : 'Archive session'}</Button></div></Modal> : null}
    {pendingWorkspacePath ? <Modal title="Trust workspace" onClose={() => setPendingWorkspacePath(undefined)}><p className="modal-copy">Allow LotaGate to use tools in this workspace?</p><p className="workspace-trust-path">{pendingWorkspacePath}</p><div className="modal-actions"><Button variant="secondary" onClick={() => setPendingWorkspacePath(undefined)}>Cancel</Button><Button variant="primary" onClick={() => void confirmAddWorkspace()} disabled={workspaceActionBusy}>{workspaceActionBusy ? 'Adding…' : 'Trust and add'}</Button></div></Modal> : null}
    {lightboxImage?.dataUrl ? <ImageLightbox src={lightboxImage.dataUrl} alt={lightboxImage.name} downloadName={lightboxImage.name} onClose={() => setLightboxImage(undefined)} /> : null}
  </div>;
}

function isViewportAtBottom(viewport: HTMLDivElement): boolean {
  return viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight <= 24;
}
