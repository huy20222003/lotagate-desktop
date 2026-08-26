import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowDown, ChevronDown, ChevronRight, Columns2, CornerUpRight, FileText, Folder, List, Minus, Paperclip, Pencil, Plus, Send, ShieldCheck, Square, Trash2, X } from 'lucide-react';
import { WorkspaceSidebar } from './WorkspaceSidebar.js';
import { SettingsPage } from '../settings/SettingsPage.js';
import type { Activity, ApprovalRequest, FileChangeDiff, FileChangeSummary, Task, TrustRequest, Workspace, WorkspaceFileSuggestion } from '../../../contracts/ipc/v1/workspace.js';
import type { UserProfile } from '../../../contracts/ipc/v1/auth.js';
import { Button, Card, CopyTextButton, Dropdown, EmptyState, Icon, Modal, Skeleton, Spinner, TextInput, TextArea, Tooltip, useToast } from '../../components/ui.js';
import { Scrollbar } from '../../components/Scrollbar.js';
import { useWorkspaceController } from './use-workspace-controller.js';
import { AgentMarkdown } from './markdown-renderer.js';
import { PromptMarkup } from './prompt-markup.js';
import type { AttachmentPreview } from './attachment-types.js';
import type { FileChangeSummariesByTurn } from './file-changes.js';
import type { ApprovalMode } from './approval-policy.js';
import { formatDuration, formatTime } from '../../utils/time.js';
import { OrchestrationPanel } from './OrchestrationPanel.js';
import { VoiceInput } from './voice-input.js';
import { mergeChatActivities } from './conversation-activities.js';
import type { QueuedMessage } from './message-queue-service.js';
import { ImageLightbox } from './ImageLightbox.js';
import { ConversationTimeline } from './ConversationTimeline.js';
import { formatTextClamp } from '../../utils/text.js';

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
  const startRename = useCallback((target: Workspace) => { setWorkspaceName(target.name); setRenameTarget(target); }, []);
  const saveWorkspaceName = useCallback(async () => {
    if (!renameTarget || !workspaceName.trim()) return;
    setWorkspaceActionBusy(true);
    try { await controller.renameWorkspace(renameTarget.id, workspaceName.trim()); success('Workspace renamed'); setRenameTarget(undefined); }
    catch (reason) { showError('Unable to rename workspace', toMessage(reason)); }
    finally { setWorkspaceActionBusy(false); }
  }, [controller, renameTarget, showError, success, workspaceName]);
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
  }, []);
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
  }, []);
  async function confirmLogout() { setLoggingOut(true); try { await window.lotagate.auth.logout(); onLoggedOut(); } finally { setLoggingOut(false); setLogoutOpen(false); } }
  const accountName = user.fullName ?? user.username ?? user.email;
  const avatarProps = user.avatarUrl ? { name: accountName, src: user.avatarUrl } : { name: accountName };
  const openChanges = useCallback((summary: FileChangeSummary) => { setChangesSummary(summary); setChangesOpen(true); }, []);
  const scrollToMessage = useCallback((activityId: string) => { document.getElementById(`chat-message-${activityId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, []);
  if (settingsOpen) return <SettingsPage user={user} {...(controller.workspace === undefined ? {} : { workspace: controller.workspace })} onBack={() => setSettingsOpen(false)} />;
  return <div className="workspace-shell">
    <WorkspaceSidebar accountName={accountName} avatarProps={avatarProps} workspaces={controller.workspaces} activeWorkspace={controller.workspace} tasks={controller.tasks} activeTask={controller.task} loading={controller.loading} accountOpen={accountOpen} onAccount={() => setAccountOpen(open => !open)} onCloseAccount={() => setAccountOpen(false)} onSettings={() => { setSettingsOpen(true); setAccountOpen(false); }} onLogout={() => { setLogoutOpen(true); setAccountOpen(false); }} onNewChat={startNewChat} onWorkspace={controller.selectWorkspace} onTask={controller.selectTask} onAddWorkspace={() => void openWorkspacePicker()} onRenameWorkspace={startRename} onRemoveWorkspace={startRemove} onArchiveTask={setArchiveTarget} onPinTask={(target, pinned) => { void controller.pinTaskById(target.id, pinned).catch(reason => showError('Unable to update session pin', toMessage(reason))); }} />
    <main className="conversation">
      <ConversationHeader task={controller.task} workspace={controller.workspace} />
      <div className="conversation-body"><ConversationTimeline activities={controller.activities} onSelect={scrollToMessage} viewportRef={threadViewportRef} /><Scrollbar className="thread-scrollbar" viewportRef={threadViewportRef}><div className="thread-content">{controller.loading || controller.activitiesLoading ? <ChatLoadingSkeleton /> : <TaskConversation task={controller.task} activities={controller.activities} activityAttachments={controller.activityAttachments} fileChangesByTurn={controller.fileChangesByTurn} onOpenFileChanges={openChanges} onOpenImage={setLightboxImage} statusText={controller.agentStatus} thinking={controller.thinking} turnTimings={controller.turnTimings} trust={controller.trust} onTrust={controller.respondTrust} />}</div></Scrollbar></div>
      <OrchestrationPanel plan={controller.plan} subagents={controller.subagents} />
      {controller.thinking && controller.fileChanges.files.length > 0 ? <ChangeSummaryChip summary={controller.fileChanges} onClick={() => openChanges(controller.fileChanges)} /> : null}
      <div className="composer-dock">{showScrollBottom ? <button type="button" className="scroll-to-bottom" aria-label="Scroll to latest message" onClick={scrollToBottom}><ArrowDown size={18} /></button> : null}<Composer disabled={controller.workspace === undefined} workspace={controller.workspace} thinking={controller.thinking} task={controller.task} attachments={controller.attachments} queuedMessages={controller.queuedMessages} models={controller.models} selectedModel={controller.selectedModel} onModel={controller.setSelectedModel} busy={controller.busy} error={controller.error} onSend={controller.sendPrompt} onCancel={controller.cancelTask} onDraft={controller.updateDraft} onAttach={controller.pickArtifact} onAttachImage={controller.attachImage} onRemoveAttachment={controller.removeAttachment} onSteerQueued={controller.steerQueuedMessage} onRemoveQueued={controller.removeQueuedMessage} onEditQueued={controller.editQueuedMessage} onOpenImage={setLightboxImage} approval={controller.approval} approvalMode={controller.approvalMode} onApprovalMode={controller.setApprovalMode} onApproval={controller.respondApproval} /></div>
      {changesOpen ? <FileChangesDrawer summary={changesSummary ?? controller.fileChanges} onClose={() => setChangesOpen(false)} /> : null}
    </main>
    {logoutOpen ? <Modal title="Sign out of LotaGate" onClose={() => setLogoutOpen(false)}><p className="modal-copy">Your server session will be cleared. Local task records remain available.</p><div className="modal-actions"><Button variant="secondary" onClick={() => setLogoutOpen(false)}>Cancel</Button><Button variant="danger" onClick={confirmLogout} disabled={loggingOut}>{loggingOut ? 'Signing out…' : 'Sign out'}</Button></div></Modal> : null}
    {renameTarget ? <Modal title="Edit workspace" onClose={() => setRenameTarget(undefined)}><div className="modal-form"><label className="field"><span className="field-label">Display name</span><TextInput value={workspaceName} onChange={event => setWorkspaceName(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') void saveWorkspaceName(); }} autoFocus /></label></div><div className="modal-actions"><Button variant="secondary" onClick={() => setRenameTarget(undefined)}>Cancel</Button><Button variant="primary" onClick={() => void saveWorkspaceName()} disabled={workspaceActionBusy || !workspaceName.trim()}>{workspaceActionBusy ? 'Saving…' : 'Save'}</Button></div></Modal> : null}
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

function TaskConversation({ task, activities, activityAttachments, fileChangesByTurn, onOpenFileChanges, onOpenImage, statusText, thinking, turnTimings, trust, onTrust }: { task?: Task | undefined; activities: Activity[]; activityAttachments: Record<string, AttachmentPreview[]>; fileChangesByTurn: FileChangeSummariesByTurn; onOpenFileChanges: (summary: FileChangeSummary) => void; onOpenImage: (attachment: AttachmentPreview) => void; statusText?: string | undefined; thinking: boolean; turnTimings: Record<string, { startedAt: number; endedAt?: number }>; trust?: TrustRequest | undefined; onTrust: (trusted: boolean) => Promise<void> }) {
  if (!task) return <EmptyState title="Create your first agent task" detail="Choose a workspace, then enter a prompt below." />;
  const transcript = mergeChatActivities(activities);
  const renderedTurnIds = new Set<string>();
  const messages = transcript.map(activity => {
    const turnId = readString(activity.metadata['turnId']);
    const fileChangeSummary = !thinking && activity.kind === 'assistant' && turnId !== undefined ? fileChangesByTurn[turnId] : undefined;
    if (fileChangeSummary !== undefined && turnId !== undefined) renderedTurnIds.add(turnId);
    return <ChatMessage key={activity.id} activity={activity} attachments={activityAttachments[activity.id] ?? []} onOpenFileChanges={onOpenFileChanges} onOpenImage={onOpenImage} {...(fileChangeSummary === undefined ? {} : { fileChangeSummary })} {...messageTiming(activity, turnTimings)} />;
  });
  const unlinkedChanges = !thinking ? Object.entries(fileChangesByTurn).filter(([turnId, summary]) => !renderedTurnIds.has(turnId) && summary.files.length > 0) : [];
  return <><div className="activity-list">{messages}{unlinkedChanges.map(([turnId, summary]) => <FileChangeCard key={`changes:${turnId}`} summary={summary} onOpenFileChanges={onOpenFileChanges} />)}</div>{statusText ? <div className="agent-status" aria-live="polite">{statusText}</div> : thinking ? <TypingIndicator /> : null}{trust ? <TrustCard request={trust} onDecision={onTrust} /> : null}</>;
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

function TrustCard({ request, onDecision }: { request: TrustRequest; onDecision: (trusted: boolean) => Promise<void> }) { return <Card className="trust-card"><div className="approval-heading"><ShieldCheck size={18} /><strong>Trust this project?</strong></div><p>The CLI needs permission to use trusted tools in <code>{request.path}</code>.</p><div className="modal-actions"><Button variant="secondary" onClick={() => void onDecision(false)}>Reject</Button><Button variant="primary" onClick={() => void onDecision(true)}>Trust project</Button></div></Card>; }

function InlineApproval({ request, onDecision }: { request: ApprovalRequest; onDecision: (approved: boolean) => Promise<void> }) { return <div className="composer-approval" role="alert"><div><strong>Approval required</strong><span>{request.displayName} wants to act on {String(request.detail['path'] ?? request.detail['command'] ?? 'the workspace')}.</span></div><div className="composer-approval-actions"><Button variant="secondary" onClick={() => void onDecision(false)}>Deny</Button><Button variant="primary" onClick={() => void onDecision(true)}>Approve</Button></div></div>; }

function Composer({ disabled, workspace, thinking, task, attachments, queuedMessages, models, selectedModel, onModel, busy, error, onSend, onCancel, onDraft, onAttach, onAttachImage, onRemoveAttachment, onSteerQueued, onRemoveQueued, onEditQueued, onOpenImage, approval, approvalMode, onApprovalMode, onApproval }: { disabled: boolean; workspace?: Workspace | undefined; thinking: boolean; task?: Task | undefined; attachments: AttachmentPreview[]; queuedMessages: readonly QueuedMessage[]; models: Array<{ id: string; label: string }>; selectedModel: string; onModel: (model: string) => void; busy: boolean; error?: string | undefined; onSend: (prompt: string) => Promise<void>; onCancel: () => Promise<void>; onDraft: (draft: string) => Promise<void>; onAttach: () => Promise<void>; onAttachImage: (name: string, bytes: Uint8Array) => Promise<void>; onRemoveAttachment: (attachmentId: string) => Promise<void>; onSteerQueued: (id: string) => Promise<void>; onRemoveQueued: (id: string) => Promise<void>; onEditQueued: (id: string) => Promise<QueuedMessage | undefined>; onOpenImage: (attachment: AttachmentPreview) => void; approval?: ApprovalRequest | undefined; approvalMode: ApprovalMode; onApprovalMode: (mode: ApprovalMode) => void; onApproval: (approved: boolean) => Promise<void> }) {
  const [draft, setDraft] = useState(task?.draft ?? '');
  const [suggestions, setSuggestions] = useState<WorkspaceFileSuggestion[]>([]);
  const [cursor, setCursor] = useState(0);
  const [suggestionIndex, setSuggestionIndex] = useState(0);
  const [inputScrollTop, setInputScrollTop] = useState(0);
  const [voiceError, setVoiceError] = useState<string | undefined>();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { setDraft(task?.draft ?? ''); setSuggestions([]); setSuggestionIndex(0); setInputScrollTop(0); }, [task?.id]);
  const updateSuggestions = useCallback(async (value: string, position: number) => {
    if (!workspace) { setSuggestions([]); return; }
    const match = /(?:^|\s)@([^\s]*)$/u.exec(value.slice(0, position));
    if (!match) { setSuggestions([]); setSuggestionIndex(0); return; }
    try { setSuggestions(await window.lotagate.workspaces.fileSuggestions(workspace.rootPath, match[1] ?? '')); setSuggestionIndex(0); }
    catch { setSuggestions([]); setSuggestionIndex(0); }
  }, [workspace]);
  const applySuggestion = (suggestion: WorkspaceFileSuggestion) => {
    const tokenMatch = /(?:^|\s)@([^\s]*)$/u.exec(draft.slice(0, cursor));
    if (!tokenMatch) return;
    const query = tokenMatch[1] ?? '';
    const tokenStart = cursor - query.length - 1;
    const next = `${draft.slice(0, tokenStart)}@${suggestion.path} ${draft.slice(cursor)}`;
    setDraft(next); setCursor(tokenStart + suggestion.path.length + 2); setSuggestions([]); setSuggestionIndex(0); void onDraft(next);
    window.requestAnimationFrame(() => { inputRef.current?.focus(); inputRef.current?.setSelectionRange(tokenStart + suggestion.path.length + 2, tokenStart + suggestion.path.length + 2); });
  };
  const send = async () => { const value = draft.trim(); if (!value || disabled || busy) return; await onSend(value); setDraft(''); void onDraft(''); setSuggestions([]); setSuggestionIndex(0); setVoiceError(undefined); };
  const completeVoiceInput = useCallback((transcript: string) => {
    const spoken = transcript.trim();
    if (!spoken) return;
    const next = draft.trimEnd() ? `${draft.trimEnd()} ${spoken}` : spoken;
    setDraft(next);
    void onDraft(next);
    setVoiceError(undefined);
  }, [draft, onDraft]);
  const options = models.map(model => ({ value: model.id, label: model.label }));
  const approvalOptions = [{ value: 'auto', label: 'Approve for me' }, { value: 'ask', label: 'Ask for approval' }];
  const stopOrSend = thinking && !draft.trim();
  return <div className={`composer ${disabled ? 'composer-disabled' : ''}`}>
    <AttachmentPreviewList attachments={attachments} onRemove={onRemoveAttachment} onOpenImage={onOpenImage} />
    <QueuedMessages messages={queuedMessages} onSteer={onSteerQueued} onRemove={onRemoveQueued} onEdit={id => { void (async () => { const message = await onEditQueued(id); if (!message) return; setDraft(message.prompt); void onDraft(message.prompt); window.requestAnimationFrame(() => inputRef.current?.focus()); })(); }} onOpenImage={onOpenImage} />
    {approval ? <InlineApproval request={approval} onDecision={onApproval} /> : null}
    <div className="prompt-input-wrap"><div className="prompt-highlight-layer" aria-hidden="true" style={{ transform: `translateY(-${inputScrollTop}px)` }}><PromptMarkup content={draft} /></div><TextArea ref={inputRef} className="prompt-input" aria-label="Prompt" disabled={disabled} placeholder={disabled ? 'Select a workspace to start a chat' : 'Do anything'} value={draft} onPaste={event => { const files = [...event.clipboardData.files].filter(file => file.type.startsWith('image/')); if (files.length === 0) return; event.preventDefault(); void (async () => { for (const file of files) await onAttachImage(file.name || 'Pasted image', new Uint8Array(await file.arrayBuffer())); })(); }} onScroll={event => setInputScrollTop(event.currentTarget.scrollTop)} onChange={event => { setDraft(event.target.value); setCursor(event.target.selectionStart); void onDraft(event.target.value); void updateSuggestions(event.target.value, event.target.selectionStart); }} onClick={event => { setCursor(event.currentTarget.selectionStart); void updateSuggestions(event.currentTarget.value, event.currentTarget.selectionStart); }} onKeyDown={event => { if (suggestions.length > 0 && event.key === 'ArrowDown') { event.preventDefault(); setSuggestionIndex(current => (current + 1) % suggestions.length); return; } if (suggestions.length > 0 && event.key === 'ArrowUp') { event.preventDefault(); setSuggestionIndex(current => (current - 1 + suggestions.length) % suggestions.length); return; } if (suggestions.length > 0 && event.key === 'Escape') { event.preventDefault(); setSuggestions([]); setSuggestionIndex(0); return; } if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); if (suggestions.length > 0) applySuggestion(suggestions[suggestionIndex] ?? suggestions[0]!); else void send(); } }} /></div>
    {suggestions.length > 0 ? <div className="mention-suggestions" role="listbox" aria-label="Workspace files">{suggestions.map((suggestion, index) => <button type="button" id={`mention-option-${index}`} key={`${suggestion.kind}:${suggestion.path}`} className={index === suggestionIndex ? 'selected' : undefined} role="option" aria-selected={index === suggestionIndex} onMouseDown={event => event.preventDefault()} onMouseEnter={() => setSuggestionIndex(index)} onClick={() => applySuggestion(suggestion)}><Icon icon={suggestion.kind === 'folder' ? Folder : FileText} size={14} /><span>{suggestion.path}</span></button>)}</div> : null}<div className="composer-footer"><button className="icon-button" aria-label="Attach context" disabled={disabled} onClick={() => void onAttach()}><Paperclip size={16} /></button><div className="approval-mode"><Dropdown value={approvalMode} options={approvalOptions} onChange={value => onApprovalMode(value as ApprovalMode)} disabled={disabled || thinking} /></div><span className="composer-spacer" />{options.length > 0 ? <Dropdown className="composer-model-dropdown" value={selectedModel} options={options} onChange={onModel} disabled={disabled || thinking} /> : <span className="model-label">Model · CLI policy</span>}<VoiceInput disabled={disabled || thinking || busy} onComplete={completeVoiceInput} onError={setVoiceError} /><Button variant="primary" aria-label={stopOrSend ? 'Cancel response' : 'Send'} disabled={disabled || busy} onClick={() => stopOrSend ? void onCancel() : void send()}>{stopOrSend ? <Square size={15} fill="currentColor" /> : busy ? <Spinner label="" /> : <Send size={16} />}</Button></div>{error || voiceError ? <p className="composer-error">{error ?? voiceError}</p> : null}</div>;
}

function QueuedMessages({ messages, onSteer, onRemove, onEdit, onOpenImage }: { messages: readonly QueuedMessage[]; onSteer: (id: string) => Promise<void>; onRemove: (id: string) => Promise<void>; onEdit: (id: string) => void; onOpenImage: (attachment: AttachmentPreview) => void }) {
  if (messages.length === 0) return null;
  return <div className="queued-messages" aria-label="Queued messages">{messages.map(message => <div className="queued-message" key={message.id}><div className="queued-message-content">{message.attachments.length > 0 ? <AttachmentPreviewList className="queued-attachment-list" attachments={message.attachments} onOpenImage={onOpenImage} /> : null}<span className="queued-message-text" title={message.prompt}>{formatTextClamp(180, message.prompt)}</span></div><div className="queued-message-actions"><Tooltip label="Steer"><button type="button" className="icon-button" aria-label="Steer queued message" onClick={() => void onSteer(message.id)}><CornerUpRight size={14} /></button></Tooltip><Tooltip label="Remove"><button type="button" className="icon-button" aria-label="Remove queued message" onClick={() => void onRemove(message.id)}><Trash2 size={14} /></button></Tooltip><Tooltip label="Edit"><button type="button" className="icon-button" aria-label="Edit queued message" onClick={() => onEdit(message.id)}><Pencil size={14} /></button></Tooltip></div></div>)}</div>;
}

function AttachmentPreviewList({ attachments, onRemove, onOpenImage, className }: { attachments: readonly AttachmentPreview[]; onRemove?: (attachmentId: string) => Promise<void>; onOpenImage?: (attachment: AttachmentPreview) => void; className?: string }) {
  if (attachments.length === 0) return null;
  return <div className={`attachment-preview-list ${onRemove ? 'composer-attachment-list' : 'user-attachment-list'} ${className ?? ''}`} aria-label="Attached files">{attachments.map(attachment => attachment.kind === 'image' && attachment.dataUrl ? <div className="image-attachment-preview" key={attachment.id}><button type="button" className="image-attachment-open" onClick={() => onOpenImage?.(attachment)} aria-label={`Open image ${attachment.name}`}><img src={attachment.dataUrl} alt={attachment.name} /></button>{onRemove ? <button type="button" className="image-attachment-remove" aria-label={`Remove ${attachment.name}`} onClick={() => void onRemove(attachment.id)}><X size={13} /></button> : null}</div> : <div className="attachment-preview" key={attachment.id}><Icon icon={FileText} size={18} /><span title={attachment.name}>{attachment.name}</span>{onRemove ? <button type="button" className="attachment-remove" aria-label={`Remove ${attachment.name}`} onClick={() => void onRemove(attachment.id)}><X size={14} /></button> : null}</div>)}</div>;
}

function TypingIndicator() { const [dots, setDots] = useState(1); useEffect(() => { const timer = window.setInterval(() => setDots(current => current === 3 ? 1 : current + 1), 420); return () => window.clearInterval(timer); }, []); return <div className="typing-indicator" aria-live="polite"><span>Thinking</span><strong>{'.'.repeat(dots)}</strong></div>; }
function ElapsedTime({ timing, fallback }: { timing?: { startedAt: number; endedAt?: number }; fallback: string }) { const startedAt = timing?.startedAt ?? Date.parse(fallback); const [now, setNow] = useState(Date.now()); useEffect(() => { if (timing?.endedAt !== undefined) return; const timer = window.setInterval(() => setNow(Date.now()), 1_000); return () => window.clearInterval(timer); }, [timing?.endedAt]); const end = timing?.endedAt ?? (timing ? now : startedAt); return <div className="worked-time">Worked for {formatDuration(Math.max(0, end - startedAt))}</div>; }

function ChangeSummaryChip({ summary, onClick }: { summary: FileChangeSummary; onClick: () => void }) {
  return <button type="button" className="change-summary-chip" onClick={onClick}><span className="change-summary-step" aria-hidden="true" /><span>{summary.files.length} {summary.files.length === 1 ? 'file' : 'files'} changed</span><span className="change-additions">+{summary.additions}</span><span className="change-deletions">-{summary.deletions}</span></button>;
}

function FileChangesDrawer({ summary, onClose }: { summary: FileChangeSummary; onClose: () => void }) {
  const [viewMode, setViewMode] = useState<DiffViewMode>('unified');
  const nextViewMode: DiffViewMode = viewMode === 'unified' ? 'split' : 'unified';
  const nextViewLabel = nextViewMode === 'split' ? 'Side-by-side diff' : 'Unified diff';
  const NextViewIcon = nextViewMode === 'split' ? Columns2 : List;
  return <><button type="button" className="file-changes-backdrop" aria-label="Close changed files" onClick={onClose} /><aside className="file-changes-drawer" aria-label="Changed files"><header><div><strong>Changed files</strong><span>{summary.files.length} files · +{summary.additions} -{summary.deletions}</span></div><div className="file-changes-header-actions"><Tooltip label={nextViewLabel}><button type="button" className="icon-button" aria-label={nextViewLabel} onClick={() => setViewMode(nextViewMode)}><NextViewIcon size={16} /></button></Tooltip><button type="button" className="icon-button" aria-label="Close changed files" onClick={onClose}><X size={16} /></button></div></header><Scrollbar className="file-changes-list">{summary.files.map(change => <FileChangeItem key={change.path} change={change} viewMode={viewMode} />)}</Scrollbar></aside></>;
}

function FileChangeCard({ summary, onOpenFileChanges }: { summary: FileChangeSummary; onOpenFileChanges: (summary: FileChangeSummary) => void }) {
  return <section className="file-change-card" aria-label="Edited files"><header><div><strong>Edited {summary.files.length} {summary.files.length === 1 ? 'file' : 'files'}</strong><span><b className="change-additions">+{summary.additions}</b><b className="change-deletions">-{summary.deletions}</b></span></div></header><div className="file-change-card-list">{summary.files.map(change => <FileChangeItem key={change.path} change={change} onOpenFileChanges={() => onOpenFileChanges(summary)} />)}</div></section>;
}

type DiffViewMode = 'unified' | 'split';

function FileChangeItem({ change, onOpenFileChanges, viewMode = 'unified' }: { change: FileChangeDiff; onOpenFileChanges?: () => void; viewMode?: DiffViewMode }) {
  const [expanded, setExpanded] = useState(true);
  const expandable = onOpenFileChanges === undefined;
  return <section className="file-change-item"><header>{expandable ? <button type="button" className="file-change-toggle" aria-label={`${expanded ? 'Collapse' : 'Expand'} changes for ${change.path}`} aria-expanded={expanded} onClick={() => setExpanded(current => !current)}>{expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</button> : null}{onOpenFileChanges ? <button type="button" className="file-change-path" title={change.path} onClick={onOpenFileChanges}>{change.path}</button> : <strong title={change.path}>{change.path}</strong>}<span><Plus size={12} />{change.additions}<Minus size={12} />{change.deletions}</span></header>{expandable && expanded ? <FileChangeDiffContent change={change} viewMode={viewMode} /> : null}</section>;
}

function FileChangeDiffContent({ change, viewMode = 'unified' }: { change: FileChangeDiff; viewMode?: DiffViewMode }) {
  if (viewMode === 'split') return <FileChangeSplitDiff change={change} />;
  return <pre>{change.lines.map((line, index) => <code className={`diff-line diff-${line.kind}`} key={`${change.path}:${index}`}><span className="diff-line-number">{line.newLine ?? line.oldLine ?? ''}</span><span>{line.kind === 'addition' ? '+' : line.kind === 'deletion' ? '-' : ' '}{line.text}</span></code>)}{change.truncated ? <code className="diff-truncated">… diff truncated …</code> : null}</pre>;
}

function FileChangeSplitDiff({ change }: { change: FileChangeDiff }) {
  return <div className="diff-split-scroll"><div className="diff-split">{splitDiffLines(change.lines).map((row, index) => <div className="diff-split-row" key={`${change.path}:split:${index}`}><DiffSide line={row.left} kind="deletion" /><DiffSide line={row.right} kind="addition" /></div>)}{change.truncated ? <div className="diff-truncated">… diff truncated …</div> : null}</div></div>;
}

function DiffSide({ line, kind }: { line: FileChangeDiff['lines'][number] | undefined; kind: 'addition' | 'deletion' }) {
  return <div className={`diff-side ${line === undefined ? 'diff-side-empty' : `diff-${line.kind === 'context' ? 'context' : kind}`}`}>{line ? <><span className="diff-line-number">{kind === 'addition' ? line.newLine ?? '' : line.oldLine ?? ''}</span><span className="diff-side-text">{line.kind === 'context' ? ` ${line.text}` : `${kind === 'addition' ? '+' : '-'}${line.text}`}</span></> : null}</div>;
}

function splitDiffLines(lines: readonly FileChangeDiff['lines'][number][]): Array<{ left?: FileChangeDiff['lines'][number]; right?: FileChangeDiff['lines'][number] }> {
  const rows: Array<{ left?: FileChangeDiff['lines'][number]; right?: FileChangeDiff['lines'][number] }> = [];
  for (let index = 0; index < lines.length;) {
    const current = lines[index];
    if (current === undefined) break;
    if (current.kind === 'context') { rows.push({ left: current, right: current }); index += 1; continue; }
    const left: FileChangeDiff['lines'][number][] = [];
    const right: FileChangeDiff['lines'][number][] = [];
    if (current.kind === 'deletion') {
      while (lines[index]?.kind === 'deletion') { left.push(lines[index] as FileChangeDiff['lines'][number]); index += 1; }
      while (lines[index]?.kind === 'addition') { right.push(lines[index] as FileChangeDiff['lines'][number]); index += 1; }
    } else {
      while (lines[index]?.kind === 'addition') { right.push(lines[index] as FileChangeDiff['lines'][number]); index += 1; }
      while (lines[index]?.kind === 'deletion') { left.push(lines[index] as FileChangeDiff['lines'][number]); index += 1; }
    }
    const count = Math.max(left.length, right.length);
    for (let offset = 0; offset < count; offset += 1) rows.push({ ...(left[offset] === undefined ? {} : { left: left[offset] }), ...(right[offset] === undefined ? {} : { right: right[offset] }) });
  }
  return rows;
}
function readString(value: unknown): string | undefined { return typeof value === 'string' && value.trim() ? value : undefined; }
function toMessage(reason: unknown): string { return reason instanceof Error ? reason.message : 'The workspace operation failed.'; }
