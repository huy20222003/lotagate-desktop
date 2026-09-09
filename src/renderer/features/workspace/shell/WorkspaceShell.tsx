import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { WorkspaceSidebar } from './WorkspaceSidebar.js';
import { SettingsPage, type SettingsSection } from '../../settings/SettingsPage.js';
import type { FileChangeSummary, Task, Workspace } from '../../../../contracts/ipc/v1/workspace.js';
import type { TerminalPlacement } from '../../../../contracts/ipc/v1/settings.js';
import type { UserProfile } from '../../../../contracts/ipc/v1/auth.js';
import { Button, Field, Modal, TextInput, useToast } from '../../../components/ui.js';
import { Scrollbar } from '../../../components/Scrollbar.js';
import { useWorkspaceController } from '../state/use-workspace-controller.js';
import { fileChangesForTurn } from '../review/file-changes.js';
import { OrchestrationPanel } from '../orchestration/OrchestrationPanel.js';
import { OrchestrationDrawer } from '../../../components/OrchestrationDrawer.js';
import { PlanDetails } from '../orchestration/PlanDetails.js';
import { ConversationTimeline } from '../conversation/ConversationTimeline.js';
import { useKeyboardShortcuts } from '../../../services/keyboard-shortcuts.js';
import { toUserErrorMessage as toMessage } from '../../../utils/errors.js';
import { workspaceNameSchema } from '../../../validation/shared.js';
import { FileChangesDrawer, GitPanel } from './WorkspaceOverlays.js';
import { Composer } from '../composer/Composer.js';
import { ConversationHeader } from '../conversation/ConversationHeader.js';
import { ChatLoadingSkeleton } from '../conversation/ChatLoadingSkeleton.js';
import { TaskConversation } from '../conversation/TaskConversation.js';
import { ChangeSummaryChip, planStepNumber } from '../review/ChangeSummaryChip.js';
import { ScrollToLatestButton } from '../conversation/ScrollToLatestButton.js';
import { NewChatWelcome } from './NewChatWelcome.js';
import { TerminalPanel } from '../integrations/TerminalPanel.js';
import { SourcesDrawer } from '../artifacts/SourcesDrawer.js';
import { BrowserPanel } from '../integrations/BrowserPanel.js';
import { useResizableSidePanel } from '../state/use-resizable-panel.js';
import { ApiKeyPromptModal } from '../../settings/ApiKeyPromptModal.js';
import { readApiKeyStatus } from '../../settings/api-key-command-client.js';
import { UndoConfirmationModal } from '../review/UndoConfirmationModal.js';
import { WorkspaceAutomationPage } from './WorkspaceAutomationPage.js';
import { RemoteControlPage } from './RemoteControlPage.js';
import { useAgentResponseNotifications } from '../state/use-agent-response-notifications.js';
import { X } from 'lucide-react';
import type { OpenFileTarget } from '../review/file-change-view.js';

export function WorkspaceShell({ user, onLoggedOut }: { user: UserProfile; onLoggedOut: () => void }) {
  const controller = useWorkspaceController();
  useAgentResponseNotifications(controller.tasks, controller.task?.id);
  const { newTask, addWorkspace } = controller;
  const { success, error: showError } = useToast();
  const [accountOpen, setAccountOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<SettingsSection>('profile');
  const [automationOpen, setAutomationOpen] = useState(false);
  const [remoteControlOpen, setRemoteControlOpen] = useState(false);
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
  const [planDrawerOpen, setPlanDrawerOpen] = useState(false);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [terminalPlacement, setTerminalPlacement] = useState<TerminalPlacement>('bottom');
  const [showContextWindowUsage, setShowContextWindowUsage] = useState(false);
  const [browserOpen, setBrowserOpen] = useState(false);
  const [gitOpen, setGitOpen] = useState(false);
  const [undoTarget, setUndoTarget] = useState<string>();
  const [undoActionBusy, setUndoActionBusy] = useState(false);
  const [agentBrowserSessionId, setAgentBrowserSessionId] = useState<string>();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const { panelWidth: sidebarWidth, resizing: sidebarResizing, startResize: startSidebarResize, handleResizeKeyDown: handleSidebarResizeKeyDown } = useResizableSidePanel({ side: 'left', initialWidth: 290, minWidth: 220, maxWidth: 420 });
  const [changesSummary, setChangesSummary] = useState<FileChangeSummary | undefined>();
  const [changesInitialExpandedPath, setChangesInitialExpandedPath] = useState<string>();
  const [changesInitialFile, setChangesInitialFile] = useState<OpenFileTarget>();
  const threadViewportRef = useRef<HTMLDivElement>(null);
  const prependScrollRef = useRef<{ top: number; height: number }>();
  const restoredPrependScrollRef = useRef(false);
  const hasRenderedActivities = useRef(false);
  const followLatestRef = useRef(true);
  const [showScrollBottom, setShowScrollBottom] = useState(false);
  const [apiKeyPromptOpen, setApiKeyPromptOpen] = useState(false);
  const apiKeyCheckCwdRef = useRef<string>();
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
    setAutomationOpen(false);
    setRemoteControlOpen(false);
    await newTask(targetWorkspace);
  }, [newTask]);
  const keyboardShortcuts = useKeyboardShortcuts({
    newSession: () => { void startNewChat(); },
    openWorkspace: () => { void openWorkspacePicker(); },
    openSettings: () => { setAutomationOpen(false); setRemoteControlOpen(false); setSettingsOpen(true); setAccountOpen(false); },
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
    const eventSessionId = envelope.event.data['sessionId'];
    if (typeof eventSessionId !== 'string' || eventSessionId !== controller.task?.sessionId) return;
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
    followLatestRef.current = true;
    hasRenderedActivities.current = false;
    prependScrollRef.current = undefined;
    restoredPrependScrollRef.current = false;
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
    const cwd = controller.workspace?.rootPath;
    if (!cwd || apiKeyCheckCwdRef.current === cwd) return;
    apiKeyCheckCwdRef.current = cwd;
    let cancelled = false;
    void readApiKeyStatus(cwd).then(authenticated => {
      if (!cancelled && !authenticated) setApiKeyPromptOpen(true);
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [controller.workspace?.rootPath]);
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
    followLatestRef.current = false;
    restoredPrependScrollRef.current = true;
    prependScrollRef.current = undefined;
  }, [controller.activities]);
  useEffect(() => {
    if (restoredPrependScrollRef.current) {
      restoredPrependScrollRef.current = false;
      hasRenderedActivities.current = true;
      return;
    }
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
  async function confirmLogout() {
    onLoggedOut();
    try { await window.lotagate.auth.logout(); } catch { /* Local logout is already complete; the server error is intentionally hidden. */ }
    success('Signed out');
  }
  const accountName = user.fullName ?? user.username ?? user.email;
  const avatarProps = user.avatarUrl ? { name: accountName, src: user.avatarUrl } : { name: accountName };
  const openChanges = useCallback((summary: FileChangeSummary, initialExpandedPath?: string) => { setPlanDrawerOpen(false); setChangesSummary(summary); setChangesInitialExpandedPath(initialExpandedPath); setChangesInitialFile(undefined); setSourcesOpen(false); setBrowserOpen(false); setGitOpen(false); setChangesOpen(true); }, []);
  const openAttachmentFile = useCallback((target: OpenFileTarget) => { setPlanDrawerOpen(false); setChangesSummary({ files: [], additions: 0, deletions: 0 }); setChangesInitialExpandedPath(undefined); setChangesInitialFile(target); setSourcesOpen(false); setBrowserOpen(false); setGitOpen(false); setChangesOpen(true); }, []);
  const openPlan = useCallback(() => { setPlanDrawerOpen(current => !current); setChangesOpen(false); setSourcesOpen(false); setBrowserOpen(false); setGitOpen(false); }, []);
  const requestUndoFileChanges = useCallback(async (turnId: string) => { setUndoTarget(turnId); }, []);
  const confirmUndoFileChanges = useCallback(async () => {
    if (!undoTarget) return;
    setUndoActionBusy(true);
    try {
      const result = await controller.undoFileChanges(undoTarget);
      if (result.state === 'undone') success('Changes undone');
      else if (result.state === 'conflict') showError('Unable to undo changes', `The workspace changed after this turn: ${result.conflicts.join(', ')}`);
      else showError('Unable to undo changes', result.error ?? 'The checkpoint is no longer available.');
    } catch (reason) { showError('Unable to undo changes', toMessage(reason)); }
    finally { setUndoActionBusy(false); setUndoTarget(undefined); }
  }, [controller, showError, success, undoTarget]);
  const latestFileChanges = controller.fileChanges.files.length > 0 ? controller.fileChanges : [...Object.values(controller.fileChangesByTurn)].reverse().find(summary => summary.files.length > 0) ?? controller.fileChanges;
  const activeTurnFileChanges = fileChangesForTurn(controller.fileChangesByTurn, controller.activeTurnId);
  const toggleFileChanges = useCallback(() => { if (changesOpen) { setChangesOpen(false); return; } setChangesSummary(latestFileChanges); setChangesInitialExpandedPath(undefined); setChangesInitialFile(undefined); setSourcesOpen(false); setBrowserOpen(false); setGitOpen(false); setChangesOpen(true); }, [changesOpen, latestFileChanges]);
  const toggleSources = useCallback(() => { if (sourcesOpen) { setSourcesOpen(false); return; } setChangesOpen(false); setBrowserOpen(false); setGitOpen(false); setSourcesOpen(true); }, [sourcesOpen]);
  const toggleGit = useCallback(() => { if (gitOpen) { setGitOpen(false); return; } setChangesOpen(false); setSourcesOpen(false); setBrowserOpen(false); setGitOpen(true); }, [gitOpen]);
  const showConversationControls = showScrollBottom || (controller.thinking && (activeTurnFileChanges.files.length > 0 || controller.plan?.status === 'active'));
  const isWelcomeState = controller.workspace !== undefined && !controller.loading && !controller.activitiesLoading && !controller.thinking && (controller.task === undefined || !controller.activities.some(activity => activity.kind === 'user'));
  useEffect(() => { setChangesSummary(undefined); setChangesInitialExpandedPath(undefined); setChangesInitialFile(undefined); setPlanDrawerOpen(false); setAgentBrowserSessionId(undefined); setBrowserOpen(false); setGitOpen(false); }, [controller.task?.id]);
  useEffect(() => { let mounted = true; void window.lotagate.settings.get().then(settings => { if (mounted) { setTerminalPlacement(settings.terminalPlacement); setShowContextWindowUsage(settings.showContextWindowUsage); } }).catch(() => undefined); return () => { mounted = false; }; }, [settingsOpen]);
  useEffect(() => { if (controller.plan?.status !== 'active') setPlanDrawerOpen(false); }, [controller.plan?.status]);
  const scrollToMessage = useCallback((activityId: string) => { document.getElementById(`chat-message-${activityId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, []);
  if (settingsOpen) return <SettingsPage user={user} {...(controller.workspace === undefined ? {} : { workspace: controller.workspace })} keyboardShortcuts={keyboardShortcuts.bindings} onUpdateShortcut={keyboardShortcuts.updateShortcut} initialSection={settingsSection} onBack={() => setSettingsOpen(false)} />;
  const composer = <Composer disabled={controller.workspace === undefined} workspace={controller.workspace} thinking={controller.thinking} task={controller.task} attachments={controller.attachments} queuedMessages={controller.queuedMessages} models={controller.models} selectedModel={controller.selectedModel} onModel={controller.setSelectedModel} selectedEffort={controller.selectedEffort} onEffort={controller.setSelectedEffort} busy={controller.busy} error={controller.error} onSend={controller.sendPrompt} onRunCommand={controller.runCommand} onCancel={controller.cancelTask} onDraft={controller.updateDraft} onAttach={controller.pickArtifact} onAttachImage={controller.attachImage} onAttachText={controller.attachText} onRemoveAttachment={controller.removeAttachment} onSteerQueued={controller.steerQueuedMessage} onRemoveQueued={controller.removeQueuedMessage} onEditQueued={controller.editQueuedMessage} approval={controller.approval} approvalMode={controller.approvalMode} onApprovalMode={controller.setApprovalMode} onApproval={controller.respondApproval} showContextWindowUsage={showContextWindowUsage} {...(controller.contextUsage === undefined ? {} : { contextUsage: controller.contextUsage })} />;
  return <div className={`workspace-shell${sidebarCollapsed ? ' sidebar-collapsed' : ''}`} style={{ gridTemplateColumns: sidebarCollapsed ? '64px minmax(0, 1fr)' : `${sidebarWidth}px minmax(0, 1fr)` }}>
     <WorkspaceSidebar accountName={accountName} avatarProps={avatarProps} workspaces={controller.workspaces} activeWorkspace={controller.workspace} tasks={controller.tasks} activeTask={controller.task} runningTaskIds={controller.runningTaskIds} unreadTaskIds={controller.unreadTaskIds} loading={controller.loading} accountOpen={accountOpen} onAccount={() => setAccountOpen(open => !open)} onCloseAccount={() => setAccountOpen(false)} onSettings={() => { setAutomationOpen(false); setRemoteControlOpen(false); setSettingsSection('profile'); setSettingsOpen(true); setAccountOpen(false); }} onPlugins={() => { setAutomationOpen(false); setRemoteControlOpen(false); setSettingsSection('plugin'); setSettingsOpen(true); setAccountOpen(false); }} onAutomations={() => { setAutomationOpen(true); setRemoteControlOpen(false); setSettingsOpen(false); setAccountOpen(false); setChangesOpen(false); setPlanDrawerOpen(false); setSourcesOpen(false); setBrowserOpen(false); setGitOpen(false); setTerminalOpen(false); }} onRemoteControl={() => { setRemoteControlOpen(true); setAutomationOpen(false); setSettingsOpen(false); setAccountOpen(false); setChangesOpen(false); setPlanDrawerOpen(false); setSourcesOpen(false); setBrowserOpen(false); setGitOpen(false); setTerminalOpen(false); }} onLogout={() => { setLogoutOpen(true); setAccountOpen(false); }} onNewChat={startNewChat} onWorkspace={workspace => { setAutomationOpen(false); setRemoteControlOpen(false); controller.selectWorkspace(workspace); }} onTask={task => { setAutomationOpen(false); setRemoteControlOpen(false); controller.selectTask(task); }} onAddWorkspace={() => void openWorkspacePicker()} onRenameWorkspace={startRename} onRemoveWorkspace={startRemove} onArchiveTask={setArchiveTarget} onPinTask={(target, pinned) => { void controller.pinTaskById(target.id, pinned).catch(reason => showError('Unable to update session pin', toMessage(reason))); }} onRenameTask={startRenameTask} collapsed={sidebarCollapsed} onToggleCollapsed={() => setSidebarCollapsed(current => !current)} sidebarResizing={sidebarResizing} onStartResize={startSidebarResize} onResizeKeyDown={handleSidebarResizeKeyDown} />
     <main className={`conversation${automationOpen || remoteControlOpen ? ' automation-view' : ''}${changesOpen ? ' has-file-changes' : ''}${browserOpen ? ' has-browser' : ''}${gitOpen ? ' has-git' : ''}${terminalOpen && terminalPlacement === 'right' ? ' has-terminal-drawer' : ''}${isWelcomeState && !automationOpen && !remoteControlOpen ? ' is-welcome' : ''}`}>
        {automationOpen ? <WorkspaceAutomationPage workspaces={controller.workspaces} /> : remoteControlOpen ? <RemoteControlPage /> : <>
        {isWelcomeState ? null : <ConversationHeader task={controller.task} workspace={controller.workspace} changesOpen={changesOpen} sourcesOpen={sourcesOpen} terminalOpen={terminalOpen} gitOpen={gitOpen} onToggleChanges={toggleFileChanges} onToggleSources={toggleSources} onToggleTerminal={() => setTerminalOpen(open => !open)} onToggleGit={toggleGit} onRenameTask={startRenameTask} onPinTask={(pinned) => { if (controller.task) void controller.pinTaskById(controller.task.id, pinned).catch(reason => showError('Unable to update session pin', toMessage(reason))); }} onArchiveTask={() => { if (controller.task) setArchiveTarget(controller.task); }} />}
       <div className="conversation-columns">
         <section className="conversation-chat">
            {isWelcomeState ? <NewChatWelcome workspace={controller.workspace}><div className="composer-dock">{composer}</div></NewChatWelcome> : <><div className="conversation-body"><ConversationTimeline activities={controller.activities} onSelect={scrollToMessage} viewportRef={threadViewportRef} /><Scrollbar className={`thread-scrollbar${controller.thinking ? ' is-thinking' : ''}`} viewportRef={threadViewportRef}><div className="thread-content">{controller.loading || controller.activitiesLoading ? <ChatLoadingSkeleton /> : <TaskConversation task={controller.task} projectRoot={controller.workspace?.rootPath} activities={controller.activities} activityAttachments={controller.activityAttachments} activityArtifacts={controller.activityArtifacts} fileChangesByTurn={controller.fileChangesByTurn} checkpointStatuses={controller.checkpointStatuses} onUndoFileChanges={requestUndoFileChanges} onOpenFileChanges={openChanges} onOpenAttachment={openAttachmentFile} statusText={controller.agentStatus} thinking={controller.thinking} finalResponseReceived={controller.finalResponseReceived} {...(controller.thinkingStartedAt === undefined ? {} : { thinkingStartedAt: controller.thinkingStartedAt })} turnTimings={controller.turnTimings} trust={controller.trust} onTrust={controller.respondTrust} subagents={controller.subagents} />}</div></Scrollbar></div><OrchestrationPanel subagents={controller.subagents} /><div className="composer-dock">{showConversationControls ? <div className="conversation-controls">{showScrollBottom ? <ScrollToLatestButton thinking={controller.thinking} awayFromLatest={showScrollBottom} onClick={scrollToBottom} /> : null}{controller.thinking && (activeTurnFileChanges.files.length > 0 || controller.plan?.status === 'active') ? <ChangeSummaryChip summary={activeTurnFileChanges} {...(controller.plan?.status === 'active' ? { plan: controller.plan } : {})} onPlanClick={openPlan} onFilesClick={() => openChanges(activeTurnFileChanges)} /> : null}</div> : null}{composer}</div>{terminalPlacement === 'bottom' && controller.workspace ? <TerminalPanel cwd={controller.workspace.rootPath} open={terminalOpen} placement="bottom" onClose={() => setTerminalOpen(false)} /> : null}</>}
          </section>
         {!isWelcomeState && terminalPlacement === 'right' && controller.workspace ? <TerminalPanel cwd={controller.workspace.rootPath} open={terminalOpen} placement="right" onClose={() => setTerminalOpen(false)} /> : null}
        {!isWelcomeState && changesOpen && controller.workspace ? <FileChangesDrawer cwd={controller.workspace.rootPath} summary={changesSummary ?? controller.fileChanges} {...(changesInitialExpandedPath === undefined ? {} : { initialExpandedPath: changesInitialExpandedPath })} {...(changesInitialFile === undefined ? {} : { initialFile: changesInitialFile })} onClose={() => { setChangesOpen(false); setChangesInitialFile(undefined); }} /> : null}
         {!isWelcomeState && planDrawerOpen && controller.plan?.status === 'active' ? <OrchestrationDrawer className="plan-drawer" title={`Plan · Step ${planStepNumber(controller.plan)} / ${controller.plan.totalSteps}`} closeIcon={X} closeLabel="Close plan" onClose={() => setPlanDrawerOpen(false)}><PlanDetails plan={controller.plan} /></OrchestrationDrawer> : null}
         {!isWelcomeState && sourcesOpen && controller.task ? <SourcesDrawer taskId={controller.task.id} refreshKey={controller.task.updatedAt} onClose={() => setSourcesOpen(false)} /> : null}
         {!isWelcomeState && browserOpen ? <BrowserPanel {...(controller.task?.id === undefined ? {} : { taskId: controller.task.id })} {...(agentBrowserSessionId === undefined ? {} : { sessionId: agentBrowserSessionId })} {...(controller.workspace?.rootPath === undefined ? {} : { cwd: controller.workspace.rootPath })} onClose={() => setBrowserOpen(false)} /> : null}
         {!isWelcomeState && gitOpen && controller.workspace ? <GitPanel cwd={controller.workspace.rootPath} onClose={() => setGitOpen(false)} /> : null}
       </div></>}
    </main>
    {logoutOpen ? <Modal title="Sign out of LotaGate" onClose={() => setLogoutOpen(false)}><p className="modal-copy">Your server session will be cleared. Local task records remain available.</p><div className="modal-actions"><Button variant="secondary" onClick={() => setLogoutOpen(false)}>Cancel</Button><Button variant="danger" onClick={confirmLogout}>Sign out</Button></div></Modal> : null}
    {renameTarget ? <Modal title="Edit workspace" onClose={() => setRenameTarget(undefined)}><div className="modal-form"><Field label="Display name" required error={workspaceNameError}><TextInput value={workspaceName} onChange={event => setWorkspaceName(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') void saveWorkspaceName(); }} autoFocus /></Field></div><div className="modal-actions"><Button variant="secondary" onClick={() => setRenameTarget(undefined)}>Cancel</Button><Button variant="primary" onClick={() => void saveWorkspaceName()} disabled={workspaceActionBusy || workspaceNameError !== undefined}>{workspaceActionBusy ? 'Saving…' : 'Save'}</Button></div></Modal> : null}
    {renameSessionTarget ? <Modal title="Rename session" onClose={() => setRenameSessionTarget(undefined)}><div className="modal-form"><Field label="Session name" required error={sessionNameError}><TextInput value={sessionName} onChange={event => setSessionName(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') void saveSessionName(); }} autoFocus /></Field></div><div className="modal-actions"><Button variant="secondary" onClick={() => setRenameSessionTarget(undefined)}>Cancel</Button><Button variant="primary" onClick={() => void saveSessionName()} disabled={workspaceActionBusy || sessionNameError !== undefined}>{workspaceActionBusy ? 'Saving…' : 'Save'}</Button></div></Modal> : null}
    {removeTarget ? <Modal title="Remove workspace" onClose={() => setRemoveTarget(undefined)}><p className="modal-copy">Are you sure you want to remove <strong>{removeTarget.name}</strong> workspace?</p><div className="modal-actions"><Button variant="secondary" onClick={() => setRemoveTarget(undefined)}>Cancel</Button><Button variant="danger" onClick={() => void confirmRemove()} disabled={workspaceActionBusy}>{workspaceActionBusy ? 'Removing…' : 'Remove'}</Button></div></Modal> : null}
    {archiveTarget ? <Modal title="Archive session" onClose={() => setArchiveTarget(undefined)}><p className="modal-copy">Are you sure you want to archive session <strong>{archiveTarget.title}</strong>?</p><div className="modal-actions"><Button variant="secondary" onClick={() => setArchiveTarget(undefined)}>Cancel</Button><Button variant="danger" onClick={() => void confirmArchive()} disabled={workspaceActionBusy}>{workspaceActionBusy ? 'Archiving…' : 'Archive session'}</Button></div></Modal> : null}
    {pendingWorkspacePath ? <Modal title="Trust workspace" onClose={() => setPendingWorkspacePath(undefined)}><p className="modal-copy">Allow LotaGate to use tools in this workspace?</p><p className="workspace-trust-path">{pendingWorkspacePath}</p><div className="modal-actions"><Button variant="secondary" onClick={() => setPendingWorkspacePath(undefined)}>Cancel</Button><Button variant="primary" onClick={() => void confirmAddWorkspace()} disabled={workspaceActionBusy}>{workspaceActionBusy ? 'Adding…' : 'Trust and add'}</Button></div></Modal> : null}
    {apiKeyPromptOpen && controller.workspace ? <ApiKeyPromptModal cwd={controller.workspace.rootPath} onClose={() => setApiKeyPromptOpen(false)} onSaved={() => setApiKeyPromptOpen(false)} /> : null}
    {undoTarget ? <UndoConfirmationModal busy={undoActionBusy} onCancel={() => setUndoTarget(undefined)} onConfirm={() => void confirmUndoFileChanges()} /> : null}
  </div>;
}

function isViewportAtBottom(viewport: HTMLDivElement): boolean {
  return viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight <= 24;
}
