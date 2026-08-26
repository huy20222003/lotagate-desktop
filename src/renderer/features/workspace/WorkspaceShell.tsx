import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowDown, Folder } from 'lucide-react';
import { WorkspaceSidebar } from './WorkspaceSidebar.js';
import { SettingsPage } from '../settings/SettingsPage.js';
import type { Activity, FileChangeSummary, Task, TrustRequest, Workspace } from '../../../contracts/ipc/v1/workspace.js';
import type { UserProfile } from '../../../contracts/ipc/v1/auth.js';
import { Button, CopyTextButton, EmptyState, Field, Modal, Skeleton, TextInput, useToast } from '../../components/ui.js';
import { Scrollbar } from '../../components/Scrollbar.js';
import { useWorkspaceController } from './use-workspace-controller.js';
import { AgentMarkdown } from './markdown-renderer.js';
import { PromptMarkup } from './prompt-markup.js';
import type { AttachmentPreview } from './attachment-types.js';
import type { FileChangeSummariesByTurn } from './file-changes.js';
import { formatDuration, formatTime } from '../../utils/time.js';
import { OrchestrationPanel } from './OrchestrationPanel.js';
import { mergeChatActivities } from './conversation-activities.js';
import { ImageLightbox } from './ImageLightbox.js';
import { ConversationTimeline } from './ConversationTimeline.js';
import { formatTextClamp } from '../../utils/text.js';
import { useKeyboardShortcuts } from '../../services/keyboard-shortcuts.js';
import { toUserErrorMessage as toMessage } from '../../utils/errors.js';
import { workspaceNameSchema } from '../../validation/shared.js';
import { readString } from '../../utils/data.js';
import { FileChangeCard, FileChangesDrawer, TrustCard } from './WorkspaceOverlays.js';
import { AttachmentPreviewList, Composer } from './Composer.js';

export function WorkspaceShell({ user, onLoggedOut }: { user: UserProfile; onLoggedOut: () => void }) {
  const controller = useWorkspaceController();
  const { newTask, addWorkspace } = controller;
  const { success, error: showError } = useToast();
  const [accountOpen, setAccountOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [logoutOpen, setLogoutOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<Workspace | undefined>();
  const [removeTarget, setRemoveTarget] = useState<Workspace | undefined>();
  const [archiveTarget, setArchiveTarget] = useState<Task | undefined>();
  const [pendingWorkspacePath, setPendingWorkspacePath] = useState<string | undefined>();
  const [workspaceName, setWorkspaceName] = useState('');
  const [workspaceActionBusy, setWorkspaceActionBusy] = useState(false);
  const [changesOpen, setChangesOpen] = useState(false);
  const [changesSummary, setChangesSummary] = useState<FileChangeSummary | undefined>();
  const [lightboxImage, setLightboxImage] = useState<AttachmentPreview | undefined>();
  const threadViewportRef = useRef<HTMLDivElement>(null);
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
  useEffect(() => {
    if (settingsOpen) return;
    const viewport = threadViewportRef.current;
    if (!viewport) return;
    const updateScrollState = () => {
      const atBottom = isViewportAtBottom(viewport);
      followLatestRef.current = atBottom;
      setShowScrollBottom(!atBottom);
    };
    updateScrollState();
    viewport.addEventListener('scroll', updateScrollState, { passive: true });
    return () => viewport.removeEventListener('scroll', updateScrollState);
  }, [settingsOpen]);
  useEffect(() => {
    if (settingsOpen) return;
    followLatestRef.current = true;
    hasRenderedActivities.current = false;
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
  }, [settingsOpen]);
  useEffect(() => {
    const viewport = threadViewportRef.current;
    const latest = controller.activities[controller.activities.length - 1];
    if (latest?.kind === 'user') followLatestRef.current = true;
    if (!viewport || (!followLatestRef.current && hasRenderedActivities.current)) return;
    const behavior = !hasRenderedActivities.current || latest?.kind === 'user' ? 'auto' : 'smooth';
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
  const openChanges = useCallback((summary: FileChangeSummary) => { setChangesSummary(summary); setChangesOpen(true); }, []);
  const scrollToMessage = useCallback((activityId: string) => { document.getElementById(`chat-message-${activityId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, []);
  if (settingsOpen) return <SettingsPage user={user} {...(controller.workspace === undefined ? {} : { workspace: controller.workspace })} keyboardShortcuts={keyboardShortcuts.bindings} onUpdateShortcut={keyboardShortcuts.updateShortcut} onBack={() => setSettingsOpen(false)} />;
  return <div className="workspace-shell">
    <WorkspaceSidebar accountName={accountName} avatarProps={avatarProps} workspaces={controller.workspaces} activeWorkspace={controller.workspace} tasks={controller.tasks} activeTask={controller.task} loading={controller.loading} accountOpen={accountOpen} onAccount={() => setAccountOpen(open => !open)} onCloseAccount={() => setAccountOpen(false)} onSettings={() => { setSettingsOpen(true); setAccountOpen(false); }} onLogout={() => { setLogoutOpen(true); setAccountOpen(false); }} onNewChat={startNewChat} onWorkspace={controller.selectWorkspace} onTask={controller.selectTask} onAddWorkspace={() => void openWorkspacePicker()} onRenameWorkspace={startRename} onRemoveWorkspace={startRemove} onArchiveTask={setArchiveTarget} onPinTask={(target, pinned) => { void controller.pinTaskById(target.id, pinned).catch(reason => showError('Unable to update session pin', toMessage(reason))); }} />
    <main className="conversation">
      <ConversationHeader task={controller.task} workspace={controller.workspace} />
      <div className="conversation-body"><ConversationTimeline activities={controller.activities} onSelect={scrollToMessage} viewportRef={threadViewportRef} /><Scrollbar className="thread-scrollbar" viewportRef={threadViewportRef}><div className="thread-content">{controller.loading || controller.activitiesLoading ? <ChatLoadingSkeleton /> : <TaskConversation task={controller.task} activities={controller.activities} activityAttachments={controller.activityAttachments} fileChangesByTurn={controller.fileChangesByTurn} onOpenFileChanges={openChanges} onOpenImage={setLightboxImage} statusText={controller.agentStatus} thinking={controller.thinking} {...(controller.thinkingStartedAt === undefined ? {} : { thinkingStartedAt: controller.thinkingStartedAt })} turnTimings={controller.turnTimings} trust={controller.trust} onTrust={controller.respondTrust} />}</div></Scrollbar></div>
      <OrchestrationPanel plan={controller.plan} subagents={controller.subagents} />
      <div className="conversation-controls"><ScrollToLatestButton thinking={controller.thinking} awayFromLatest={showScrollBottom} onClick={scrollToBottom} />{controller.thinking && controller.fileChanges.files.length > 0 ? <ChangeSummaryChip summary={controller.fileChanges} onClick={() => openChanges(controller.fileChanges)} /> : null}</div>
      <div className="composer-dock"><Composer disabled={controller.workspace === undefined} workspace={controller.workspace} thinking={controller.thinking} task={controller.task} attachments={controller.attachments} queuedMessages={controller.queuedMessages} models={controller.models} selectedModel={controller.selectedModel} onModel={controller.setSelectedModel} busy={controller.busy} error={controller.error} onSend={controller.sendPrompt} onRunCommand={controller.runCommand} onCancel={controller.cancelTask} onDraft={controller.updateDraft} onAttach={controller.pickArtifact} onAttachImage={controller.attachImage} onRemoveAttachment={controller.removeAttachment} onSteerQueued={controller.steerQueuedMessage} onRemoveQueued={controller.removeQueuedMessage} onEditQueued={controller.editQueuedMessage} onOpenImage={setLightboxImage} approval={controller.approval} approvalMode={controller.approvalMode} onApprovalMode={controller.setApprovalMode} onApproval={controller.respondApproval} /></div>
      {changesOpen ? <FileChangesDrawer summary={changesSummary ?? controller.fileChanges} onClose={() => setChangesOpen(false)} /> : null}
    </main>
    {logoutOpen ? <Modal title="Sign out of LotaGate" onClose={() => setLogoutOpen(false)}><p className="modal-copy">Your server session will be cleared. Local task records remain available.</p><div className="modal-actions"><Button variant="secondary" onClick={() => setLogoutOpen(false)}>Cancel</Button><Button variant="danger" onClick={confirmLogout} disabled={loggingOut}>{loggingOut ? 'Signing out…' : 'Sign out'}</Button></div></Modal> : null}
    {renameTarget ? <Modal title="Edit workspace" onClose={() => setRenameTarget(undefined)}><div className="modal-form"><Field label="Display name" required error={workspaceNameError}><TextInput value={workspaceName} onChange={event => setWorkspaceName(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') void saveWorkspaceName(); }} autoFocus /></Field></div><div className="modal-actions"><Button variant="secondary" onClick={() => setRenameTarget(undefined)}>Cancel</Button><Button variant="primary" onClick={() => void saveWorkspaceName()} disabled={workspaceActionBusy || workspaceNameError !== undefined}>{workspaceActionBusy ? 'Saving…' : 'Save'}</Button></div></Modal> : null}
    {removeTarget ? <Modal title="Remove workspace" onClose={() => setRemoveTarget(undefined)}><p className="modal-copy">Are you want to remove <strong>{removeTarget.name}</strong> workspace?</p><div className="modal-actions"><Button variant="secondary" onClick={() => setRemoveTarget(undefined)}>Cancel</Button><Button variant="danger" onClick={() => void confirmRemove()} disabled={workspaceActionBusy}>{workspaceActionBusy ? 'Removing…' : 'Remove workspace'}</Button></div></Modal> : null}
    {archiveTarget ? <Modal title="Archive session" onClose={() => setArchiveTarget(undefined)}><p className="modal-copy">Are you want to archive session <strong>{archiveTarget.title}</strong></p><div className="modal-actions"><Button variant="secondary" onClick={() => setArchiveTarget(undefined)}>Cancel</Button><Button variant="danger" onClick={() => void confirmArchive()} disabled={workspaceActionBusy}>{workspaceActionBusy ? 'Archiving…' : 'Archive session'}</Button></div></Modal> : null}
    {pendingWorkspacePath ? <Modal title="Trust workspace" onClose={() => setPendingWorkspacePath(undefined)}><p className="modal-copy">Allow LotaGate to use tools in this workspace?</p><p className="workspace-trust-path">{pendingWorkspacePath}</p><div className="modal-actions"><Button variant="secondary" onClick={() => setPendingWorkspacePath(undefined)}>Cancel</Button><Button variant="primary" onClick={() => void confirmAddWorkspace()} disabled={workspaceActionBusy}>{workspaceActionBusy ? 'Adding…' : 'Trust and add'}</Button></div></Modal> : null}
    {lightboxImage?.dataUrl ? <ImageLightbox src={lightboxImage.dataUrl} alt={lightboxImage.name} onClose={() => setLightboxImage(undefined)} /> : null}
  </div>;
}

function ConversationHeader({ task, workspace }: { task?: Task | undefined; workspace?: Workspace | undefined }) {
  return <header className="conversation-header"><div className="task-title"><Folder size={17} /><strong>{task?.title ?? workspace?.name ?? 'Agent Workspace'}</strong></div></header>;
}

function isViewportAtBottom(viewport: HTMLDivElement): boolean {
  return viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight <= 24;
}

function ChatLoadingSkeleton() {
  return <div className="chat-loading-skeleton" aria-label="Loading chat"><Skeleton className="skeleton-chat-line skeleton-chat-short" /><Skeleton className="skeleton-chat-line" /><Skeleton className="skeleton-chat-line skeleton-chat-medium" /><Skeleton className="skeleton-chat-block" /></div>;
}

function TaskConversation({ task, activities, activityAttachments, fileChangesByTurn, onOpenFileChanges, onOpenImage, statusText, thinking, thinkingStartedAt, turnTimings, trust, onTrust }: { task?: Task | undefined; activities: Activity[]; activityAttachments: Record<string, AttachmentPreview[]>; fileChangesByTurn: FileChangeSummariesByTurn; onOpenFileChanges: (summary: FileChangeSummary) => void; onOpenImage: (attachment: AttachmentPreview) => void; statusText?: string | undefined; thinking: boolean; thinkingStartedAt?: number; turnTimings: Record<string, { startedAt: number; endedAt?: number }>; trust?: TrustRequest | undefined; onTrust: (trusted: boolean) => Promise<void> }) {
  if (!task) return <EmptyState title="Create your first agent task" detail="Choose a workspace, then enter a prompt below." />;
  const transcript = mergeChatActivities(activities);
  const activeTiming = findActiveTurnTiming(turnTimings);
  const workingTiming = activeTiming ?? (thinkingStartedAt === undefined ? undefined : { startedAt: thinkingStartedAt });
  const hasActiveAssistant = transcript.some(activity => {
    if (activity.kind !== 'assistant') return false;
    const timing = messageTiming(activity, turnTimings).timing;
    return timing !== undefined && timing.endedAt === undefined;
  });
  const renderedTurnIds = new Set<string>();
  const messages = transcript.map(activity => {
    const turnId = readString(activity.metadata['turnId']);
    const fileChangeSummary = !thinking && activity.kind === 'assistant' && turnId !== undefined ? fileChangesByTurn[turnId] : undefined;
    if (fileChangeSummary !== undefined && turnId !== undefined) renderedTurnIds.add(turnId);
    return <ChatMessage key={activity.id} activity={activity} attachments={activityAttachments[activity.id] ?? []} onOpenFileChanges={onOpenFileChanges} onOpenImage={onOpenImage} {...(fileChangeSummary === undefined ? {} : { fileChangeSummary })} {...messageTiming(activity, turnTimings)} />;
  });
  const unlinkedChanges = !thinking ? Object.entries(fileChangesByTurn).filter(([turnId, summary]) => !renderedTurnIds.has(turnId) && summary.files.length > 0) : [];
  return <><div className="activity-list">{messages}{unlinkedChanges.map(([turnId, summary]) => <FileChangeCard key={`changes:${turnId}`} summary={summary} onOpenFileChanges={onOpenFileChanges} />)}</div>{thinking && !hasActiveAssistant && workingTiming ? <ElapsedTime timing={workingTiming} fallback={task.createdAt} /> : null}{statusText ? <div className="agent-status" aria-live="polite">{statusText}</div> : thinking ? <TypingIndicator /> : null}{trust ? <TrustCard request={trust} onDecision={onTrust} /> : null}</>;
}

function findActiveTurnTiming(turnTimings: Record<string, { startedAt: number; endedAt?: number }>): { startedAt: number; endedAt?: number } | undefined {
  return Object.values(turnTimings).filter(timing => timing.endedAt === undefined).sort((left, right) => right.startedAt - left.startedAt)[0];
}

function messageTiming(activity: Activity, turnTimings: Record<string, { startedAt: number; endedAt?: number }>): { timing?: { startedAt: number; endedAt?: number } } {
  if (activity.kind !== 'assistant' && activity.kind !== 'error') return {};
  const timing = turnTimings[String(activity.metadata['turnId'] ?? '')];
  return timing === undefined ? {} : { timing };
}

function ChatMessage({ activity, attachments, timing, fileChangeSummary, onOpenFileChanges, onOpenImage }: { activity: Activity; attachments: AttachmentPreview[]; timing?: { startedAt: number; endedAt?: number }; fileChangeSummary?: FileChangeSummary; onOpenFileChanges: (summary: FileChangeSummary) => void; onOpenImage: (attachment: AttachmentPreview) => void }) {
  if (activity.kind === 'user') return <UserMessage activity={activity} attachments={attachments} onOpenImage={onOpenImage} />;
  return <AgentMessage activity={activity} onOpenFileChanges={onOpenFileChanges} {...(timing === undefined ? {} : { timing })} {...(fileChangeSummary === undefined ? {} : { fileChangeSummary })} />;
}

function AgentMessage({ activity, timing, fileChangeSummary, onOpenFileChanges }: { activity: Activity; timing?: { startedAt: number; endedAt?: number }; fileChangeSummary?: FileChangeSummary; onOpenFileChanges: (summary: FileChangeSummary) => void }) {
  return <article className="message agent-message"><div className="message-body"><ElapsedTime {...(timing === undefined ? {} : { timing })} fallback={activity.createdAt} /><AgentMarkdown content={activity.text} />{fileChangeSummary && fileChangeSummary.files.length > 0 ? <FileChangeCard summary={fileChangeSummary} onOpenFileChanges={onOpenFileChanges} /> : null}<div className="agent-message-meta"><CopyTextButton content={activity.text} label="Copy response" /><time dateTime={activity.createdAt}>{formatTime(activity.createdAt)}</time></div></div></article>;
}

function UserMessage({ activity, attachments, onOpenImage }: { activity: Activity; attachments: AttachmentPreview[]; onOpenImage: (attachment: AttachmentPreview) => void }) {
  const [expanded, setExpanded] = useState(false);
  const limit = 480;
  const collapsible = activity.text.length > limit;
  const text = !expanded ? formatTextClamp(limit, activity.text) : activity.text;
  return <article id={`chat-message-${activity.id}`} className="message user-message"><div className="message-body"><AttachmentPreviewList attachments={attachments} onOpenImage={onOpenImage} /><div className="user-message-bubble"><div className="user-message-text"><PromptMarkup content={text} /></div>{collapsible ? <button className="show-more" onClick={() => setExpanded(current => !current)}>{expanded ? 'Show less' : 'Show more'}</button> : null}</div><div className="user-message-meta"><time dateTime={activity.createdAt}>{formatTime(activity.createdAt)}</time><CopyTextButton content={activity.text} label="Copy message" /></div></div></article>;
}

function TypingIndicator() { const [dots, setDots] = useState(1); useEffect(() => { const timer = window.setInterval(() => setDots(current => current === 3 ? 1 : current + 1), 420); return () => window.clearInterval(timer); }, []); return <div className="typing-indicator" aria-live="polite"><span>Thinking</span><strong>{'.'.repeat(dots)}</strong></div>; }
function ElapsedTime({ timing, fallback }: { timing?: { startedAt: number; endedAt?: number }; fallback: string }) { const startedAt = timing?.startedAt ?? Date.parse(fallback); const [now, setNow] = useState(Date.now()); useEffect(() => { if (timing?.endedAt !== undefined) return; const timer = window.setInterval(() => setNow(Date.now()), 1_000); return () => window.clearInterval(timer); }, [timing?.endedAt]); const end = timing?.endedAt ?? (timing ? now : startedAt); return <div className="worked-time">Worked for {formatDuration(Math.max(0, end - startedAt))}</div>; }

function ChangeSummaryChip({ summary, onClick }: { summary: FileChangeSummary; onClick: () => void }) {
  return <button type="button" className="change-summary-chip" onClick={onClick}><span className="change-summary-step" aria-hidden="true" /><span>{summary.files.length} {summary.files.length === 1 ? 'file' : 'files'} changed</span><span className="change-additions">+{summary.additions}</span><span className="change-deletions">-{summary.deletions}</span></button>;
}

function ScrollToLatestButton({ thinking, awayFromLatest, onClick }: { thinking: boolean; awayFromLatest: boolean; onClick: () => void }) {
  return <button type="button" className={`scroll-to-bottom${thinking ? ' is-thinking' : ''}${awayFromLatest ? ' is-away' : ''}`} aria-label={thinking ? 'Agent is working; scroll to latest message' : 'Scroll to latest message'} title={thinking ? 'Agent is working' : 'Scroll to latest message'} onClick={onClick}>{thinking ? <span className="scroll-thinking-dots" aria-hidden="true"><i /><i /><i /></span> : <ArrowDown size={18} />}</button>;
}
