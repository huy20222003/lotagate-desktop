import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, ChevronRight, Copy, FileText, Folder, Minus, Paperclip, Plus, Send, ShieldCheck, Square, X } from 'lucide-react';
import { WorkspaceSidebar } from './WorkspaceSidebar.js';
import { SettingsPage } from '../settings/SettingsPage.js';
import type { Activity, ApprovalRequest, FileChangeDiff, FileChangeSummary, Task, TrustRequest, Workspace, WorkspaceFileSuggestion } from '../../../contracts/ipc/v1/workspace.js';
import type { UserProfile } from '../../../contracts/ipc/v1/auth.js';
import { Button, Card, Dropdown, EmptyState, Icon, Modal, Skeleton, Spinner, TextInput, TextArea, Tooltip, useToast } from '../../components/ui.js';
import { Scrollbar } from '../../components/Scrollbar.js';
import { useWorkspaceController } from './use-workspace-controller.js';
import { AgentMarkdown } from './markdown-renderer.js';
import { PromptMarkup } from './prompt-markup.js';
import type { AttachmentPreview } from './use-workspace-controller.js';
import type { FileChangeSummariesByTurn } from './file-changes.js';
import type { ApprovalMode } from './approval-policy.js';
import { formatDuration, formatTime } from '../../utils/time.js';
import { OrchestrationPanel } from './OrchestrationPanel.js';

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
  const threadViewportRef = useRef<HTMLDivElement>(null);
  const hasRenderedActivities = useRef(false);
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
    const latest = controller.activities[controller.activities.length - 1];
    const behavior = !hasRenderedActivities.current || latest?.kind === 'user' ? 'auto' : 'smooth';
    hasRenderedActivities.current = true;
    window.requestAnimationFrame(() => viewport.scrollTo({ top: viewport.scrollHeight, behavior }));
  }, [controller.activities, controller.agentStatus, controller.thinking]);
  async function confirmLogout() { setLoggingOut(true); try { await window.lotagate.auth.logout(); onLoggedOut(); } finally { setLoggingOut(false); setLogoutOpen(false); } }
  const accountName = user.fullName ?? user.username ?? user.email;
  const avatarProps = user.avatarUrl ? { name: accountName, src: user.avatarUrl } : { name: accountName };
  const openChanges = useCallback((summary: FileChangeSummary) => { setChangesSummary(summary); setChangesOpen(true); }, []);
  if (settingsOpen) return <SettingsPage user={user} onBack={() => setSettingsOpen(false)} />;
  return <div className="workspace-shell">
    <WorkspaceSidebar accountName={accountName} avatarProps={avatarProps} workspaces={controller.workspaces} activeWorkspace={controller.workspace} tasks={controller.tasks} activeTask={controller.task} loading={controller.loading} accountOpen={accountOpen} onAccount={() => setAccountOpen(open => !open)} onCloseAccount={() => setAccountOpen(false)} onSettings={() => { setSettingsOpen(true); setAccountOpen(false); }} onLogout={() => { setLogoutOpen(true); setAccountOpen(false); }} onNewChat={startNewChat} onWorkspace={controller.selectWorkspace} onTask={controller.selectTask} onAddWorkspace={() => void openWorkspacePicker()} onRenameWorkspace={startRename} onRemoveWorkspace={startRemove} onArchiveTask={setArchiveTarget} onPinTask={(target, pinned) => { void controller.pinTaskById(target.id, pinned).catch(reason => showError('Unable to update session pin', toMessage(reason))); }} />
    <main className="conversation">
      <ConversationHeader task={controller.task} workspace={controller.workspace} />
      <Scrollbar className="thread-scrollbar" viewportRef={threadViewportRef}><div className="thread-content">{controller.loading || controller.activitiesLoading ? <ChatLoadingSkeleton /> : <TaskConversation task={controller.task} activities={controller.activities} fileChangesByTurn={controller.fileChangesByTurn} onOpenFileChanges={openChanges} statusText={controller.agentStatus} thinking={controller.thinking} turnTimings={controller.turnTimings} trust={controller.trust} onTrust={controller.respondTrust} />}</div></Scrollbar>
      <OrchestrationPanel plan={controller.plan} subagents={controller.subagents} />
      {controller.thinking && controller.fileChanges.files.length > 0 ? <ChangeSummaryChip summary={controller.fileChanges} onClick={() => openChanges(controller.fileChanges)} /> : null}
      <Composer disabled={controller.workspace === undefined} workspace={controller.workspace} thinking={controller.thinking} task={controller.task} attachments={controller.attachments} models={controller.models} selectedModel={controller.selectedModel} onModel={controller.setSelectedModel} busy={controller.busy} error={controller.error} onSend={controller.sendPrompt} onCancel={controller.cancelTask} onDraft={controller.updateDraft} onAttach={controller.pickArtifact} onAttachImage={controller.attachImage} onRemoveAttachment={controller.removeAttachment} approval={controller.approval} approvalMode={controller.approvalMode} onApprovalMode={controller.setApprovalMode} onApproval={controller.respondApproval} />
      {changesOpen ? <FileChangesDrawer summary={changesSummary ?? controller.fileChanges} onClose={() => setChangesOpen(false)} /> : null}
    </main>
    {logoutOpen ? <Modal title="Sign out of LotaGate" onClose={() => setLogoutOpen(false)}><p className="modal-copy">Your server session will be cleared. Local task records remain available.</p><div className="modal-actions"><Button variant="secondary" onClick={() => setLogoutOpen(false)}>Cancel</Button><Button variant="danger" onClick={confirmLogout} disabled={loggingOut}>{loggingOut ? 'Signing out…' : 'Sign out'}</Button></div></Modal> : null}
    {renameTarget ? <Modal title="Edit workspace" onClose={() => setRenameTarget(undefined)}><div className="modal-form"><label className="field"><span className="field-label">Display name</span><TextInput value={workspaceName} onChange={event => setWorkspaceName(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') void saveWorkspaceName(); }} autoFocus /></label></div><div className="modal-actions"><Button variant="secondary" onClick={() => setRenameTarget(undefined)}>Cancel</Button><Button variant="primary" onClick={() => void saveWorkspaceName()} disabled={workspaceActionBusy || !workspaceName.trim()}>{workspaceActionBusy ? 'Saving…' : 'Save'}</Button></div></Modal> : null}
    {removeTarget ? <Modal title="Remove workspace" onClose={() => setRemoveTarget(undefined)}><p className="modal-copy">Are you want to remove <strong>{removeTarget.name}</strong> workspace?</p><div className="modal-actions"><Button variant="secondary" onClick={() => setRemoveTarget(undefined)}>Cancel</Button><Button variant="danger" onClick={() => void confirmRemove()} disabled={workspaceActionBusy}>{workspaceActionBusy ? 'Removing…' : 'Remove workspace'}</Button></div></Modal> : null}
    {archiveTarget ? <Modal title="Archive session" onClose={() => setArchiveTarget(undefined)}><p className="modal-copy">Are you want to archive session <strong>{archiveTarget.title}</strong></p><div className="modal-actions"><Button variant="secondary" onClick={() => setArchiveTarget(undefined)}>Cancel</Button><Button variant="danger" onClick={() => void confirmArchive()} disabled={workspaceActionBusy}>{workspaceActionBusy ? 'Archiving…' : 'Archive session'}</Button></div></Modal> : null}
    {pendingWorkspacePath ? <Modal title="Trust workspace" onClose={() => setPendingWorkspacePath(undefined)}><p className="modal-copy">Allow LotaGate to use tools in this workspace?</p><p className="workspace-trust-path">{pendingWorkspacePath}</p><div className="modal-actions"><Button variant="secondary" onClick={() => setPendingWorkspacePath(undefined)}>Cancel</Button><Button variant="primary" onClick={() => void confirmAddWorkspace()} disabled={workspaceActionBusy}>{workspaceActionBusy ? 'Adding…' : 'Trust and add'}</Button></div></Modal> : null}
  </div>;
}

function ConversationHeader({ task, workspace }: { task?: Task | undefined; workspace?: Workspace | undefined }) {
  return <header className="conversation-header"><div className="task-title"><Folder size={17} /><strong>{task?.title ?? workspace?.name ?? 'Agent Workspace'}</strong></div></header>;
}

function ChatLoadingSkeleton() {
  return <div className="chat-loading-skeleton" aria-label="Loading chat"><Skeleton className="skeleton-chat-line skeleton-chat-short" /><Skeleton className="skeleton-chat-line" /><Skeleton className="skeleton-chat-line skeleton-chat-medium" /><Skeleton className="skeleton-chat-block" /></div>;
}

function TaskConversation({ task, activities, fileChangesByTurn, onOpenFileChanges, statusText, thinking, turnTimings, trust, onTrust }: { task?: Task | undefined; activities: Activity[]; fileChangesByTurn: FileChangeSummariesByTurn; onOpenFileChanges: (summary: FileChangeSummary) => void; statusText?: string | undefined; thinking: boolean; turnTimings: Record<string, { startedAt: number; endedAt?: number }>; trust?: TrustRequest | undefined; onTrust: (trusted: boolean) => Promise<void> }) {
  if (!task) return <EmptyState title="Create your first agent task" detail="Choose a workspace, then enter a prompt below." />;
  const transcript = mergeChatActivities(activities);
  return <><div className="activity-list">{transcript.map(activity => { const fileChangeSummary = fileChangesByTurn[String(activity.metadata['turnId'] ?? '')]; return <ChatMessage key={activity.id} activity={activity} onOpenFileChanges={onOpenFileChanges} {...(fileChangeSummary === undefined ? {} : { fileChangeSummary })} {...messageTiming(activity, turnTimings)} />; })}</div>{statusText ? <div className="agent-status" aria-live="polite">{statusText}</div> : thinking ? <TypingIndicator /> : null}{trust ? <TrustCard request={trust} onDecision={onTrust} /> : null}</>;
}

function messageTiming(activity: Activity, turnTimings: Record<string, { startedAt: number; endedAt?: number }>): { timing?: { startedAt: number; endedAt?: number } } {
  if (activity.kind !== 'assistant') return {};
  const timing = turnTimings[String(activity.metadata['turnId'] ?? '')];
  return timing === undefined ? {} : { timing };
}

function ChatMessage({ activity, timing, fileChangeSummary, onOpenFileChanges }: { activity: Activity; timing?: { startedAt: number; endedAt?: number }; fileChangeSummary?: FileChangeSummary; onOpenFileChanges: (summary: FileChangeSummary) => void }) {
  if (activity.kind === 'user') return <UserMessage activity={activity} />;
  return <AgentMessage activity={activity} onOpenFileChanges={onOpenFileChanges} {...(timing === undefined ? {} : { timing })} {...(fileChangeSummary === undefined ? {} : { fileChangeSummary })} />;
}

function AgentMessage({ activity, timing, fileChangeSummary, onOpenFileChanges }: { activity: Activity; timing?: { startedAt: number; endedAt?: number }; fileChangeSummary?: FileChangeSummary; onOpenFileChanges: (summary: FileChangeSummary) => void }) {
  return <article className="message agent-message"><div className="message-body"><ElapsedTime {...(timing === undefined ? {} : { timing })} fallback={activity.createdAt} /><AgentMarkdown content={activity.text} />{fileChangeSummary && fileChangeSummary.files.length > 0 ? <FileChangeCard summary={fileChangeSummary} onOpenFileChanges={onOpenFileChanges} /> : null}<div className="agent-message-meta"><CopyTextButton content={activity.text} label="Copy response" /><time dateTime={activity.createdAt}>{formatTime(activity.createdAt)}</time></div></div></article>;
}

function UserMessage({ activity }: { activity: Activity }) {
  const [expanded, setExpanded] = useState(false);
  const limit = 480;
  const collapsible = activity.text.length > limit;
  const text = !expanded && collapsible ? `${activity.text.slice(0, limit).trimEnd()}…` : activity.text;
  return <article className="message user-message"><div className="message-body"><div className="user-message-text"><PromptMarkup content={text} /></div>{collapsible ? <button className="show-more" onClick={() => setExpanded(current => !current)}>{expanded ? 'Show less' : 'Show more'}</button> : null}<div className="user-message-meta"><time dateTime={activity.createdAt}>{formatTime(activity.createdAt)}</time><CopyTextButton content={activity.text} label="Copy message" /></div></div></article>;
}

function mergeChatActivities(activities: Activity[]): Activity[] {
  const transcript: Activity[] = [];
  for (const activity of activities) {
    if (activity.kind !== 'user' && activity.kind !== 'assistant' && activity.kind !== 'error') continue;
    if (activity.kind === 'assistant' && activity.text.trim() === 'Agent turn completed.') continue;
    const previous = transcript[transcript.length - 1];
    if (activity.kind === 'assistant' && previous?.kind === 'assistant' && previous.metadata['turnId'] === activity.metadata['turnId']) {
      transcript[transcript.length - 1] = { ...previous, text: `${previous.text}${activity.text}`, metadata: { ...previous.metadata, ...activity.metadata } };
    } else transcript.push(activity);
  }
  return transcript;
}

function TrustCard({ request, onDecision }: { request: TrustRequest; onDecision: (trusted: boolean) => Promise<void> }) { return <Card className="trust-card"><div className="approval-heading"><ShieldCheck size={18} /><strong>Trust this project?</strong></div><p>The CLI needs permission to use trusted tools in <code>{request.path}</code>.</p><div className="modal-actions"><Button variant="secondary" onClick={() => void onDecision(false)}>Reject</Button><Button variant="primary" onClick={() => void onDecision(true)}>Trust project</Button></div></Card>; }

function InlineApproval({ request, onDecision }: { request: ApprovalRequest; onDecision: (approved: boolean) => Promise<void> }) { return <div className="composer-approval" role="alert"><div><strong>Approval required</strong><span>{request.displayName} wants to act on {String(request.detail['path'] ?? request.detail['command'] ?? 'the workspace')}.</span></div><div className="composer-approval-actions"><Button variant="secondary" onClick={() => void onDecision(false)}>Deny</Button><Button variant="primary" onClick={() => void onDecision(true)}>Approve</Button></div></div>; }

function Composer({ disabled, workspace, thinking, task, attachments, models, selectedModel, onModel, busy, error, onSend, onCancel, onDraft, onAttach, onAttachImage, onRemoveAttachment, approval, approvalMode, onApprovalMode, onApproval }: { disabled: boolean; workspace?: Workspace | undefined; thinking: boolean; task?: Task | undefined; attachments: AttachmentPreview[]; models: Array<{ id: string; label: string }>; selectedModel: string; onModel: (model: string) => void; busy: boolean; error?: string | undefined; onSend: (prompt: string) => Promise<void>; onCancel: () => Promise<void>; onDraft: (draft: string) => Promise<void>; onAttach: () => Promise<void>; onAttachImage: (name: string, bytes: Uint8Array) => Promise<void>; onRemoveAttachment: (attachmentId: string) => Promise<void>; approval?: ApprovalRequest | undefined; approvalMode: ApprovalMode; onApprovalMode: (mode: ApprovalMode) => void; onApproval: (approved: boolean) => Promise<void> }) {
  const [draft, setDraft] = useState(task?.draft ?? '');
  const [suggestions, setSuggestions] = useState<WorkspaceFileSuggestion[]>([]);
  const [cursor, setCursor] = useState(0);
  const [suggestionIndex, setSuggestionIndex] = useState(0);
  const [inputScrollTop, setInputScrollTop] = useState(0);
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
  const send = async () => { const value = draft.trim(); if (!value || disabled || thinking || busy) return; await onSend(value); setDraft(''); setSuggestions([]); setSuggestionIndex(0); };
  const options = models.map(model => ({ value: model.id, label: model.label }));
  const approvalOptions = [{ value: 'auto', label: 'Approve for me' }, { value: 'ask', label: 'Ask for approval' }];
  return <div className={`composer ${disabled ? 'composer-disabled' : ''}`}>
    {attachments.length > 0 ? <div className="attachment-preview-list" aria-label="Attached files">{attachments.map(attachment => <div className="attachment-preview" key={attachment.id}>{attachment.dataUrl ? <img src={attachment.dataUrl} alt={attachment.name} /> : <Icon icon={FileText} size={18} />}<span title={attachment.name}>{attachment.name}</span><button type="button" className="attachment-remove" aria-label={`Remove ${attachment.name}`} onClick={() => void onRemoveAttachment(attachment.id)}><X size={14} /></button></div>)}</div> : null}
    {approval ? <InlineApproval request={approval} onDecision={onApproval} /> : null}
    <div className="prompt-input-wrap"><div className="prompt-highlight-layer" aria-hidden="true" style={{ transform: `translateY(-${inputScrollTop}px)` }}><PromptMarkup content={draft} /></div><TextArea ref={inputRef} className="prompt-input" aria-label="Prompt" disabled={disabled || thinking} placeholder={disabled ? 'Select a workspace to start a chat' : 'Do anything'} value={draft} onPaste={event => { const files = [...event.clipboardData.files].filter(file => file.type.startsWith('image/')); if (files.length === 0) return; event.preventDefault(); void (async () => { for (const file of files) await onAttachImage(file.name || 'Pasted image', new Uint8Array(await file.arrayBuffer())); })(); }} onScroll={event => setInputScrollTop(event.currentTarget.scrollTop)} onChange={event => { setDraft(event.target.value); setCursor(event.target.selectionStart); void onDraft(event.target.value); void updateSuggestions(event.target.value, event.target.selectionStart); }} onClick={event => { setCursor(event.currentTarget.selectionStart); void updateSuggestions(event.currentTarget.value, event.currentTarget.selectionStart); }} onKeyDown={event => { if (suggestions.length > 0 && event.key === 'ArrowDown') { event.preventDefault(); setSuggestionIndex(current => (current + 1) % suggestions.length); return; } if (suggestions.length > 0 && event.key === 'ArrowUp') { event.preventDefault(); setSuggestionIndex(current => (current - 1 + suggestions.length) % suggestions.length); return; } if (suggestions.length > 0 && event.key === 'Escape') { event.preventDefault(); setSuggestions([]); setSuggestionIndex(0); return; } if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); if (suggestions.length > 0) applySuggestion(suggestions[suggestionIndex] ?? suggestions[0]!); else void send(); } }} /></div>
    {suggestions.length > 0 ? <div className="mention-suggestions" role="listbox" aria-label="Workspace files">{suggestions.map((suggestion, index) => <button type="button" id={`mention-option-${index}`} key={`${suggestion.kind}:${suggestion.path}`} className={index === suggestionIndex ? 'selected' : undefined} role="option" aria-selected={index === suggestionIndex} onMouseDown={event => event.preventDefault()} onMouseEnter={() => setSuggestionIndex(index)} onClick={() => applySuggestion(suggestion)}><Icon icon={suggestion.kind === 'folder' ? Folder : FileText} size={14} /><span>{suggestion.path}</span></button>)}</div> : null}<div className="composer-footer"><button className="icon-button" aria-label="Attach context" disabled={disabled || thinking} onClick={() => void onAttach()}><Paperclip size={16} /></button><div className="approval-mode"><Dropdown value={approvalMode} options={approvalOptions} onChange={value => onApprovalMode(value as ApprovalMode)} disabled={disabled || thinking} /></div><span className="composer-spacer" />{options.length > 0 ? <Dropdown className="composer-model-dropdown" value={selectedModel} options={options} onChange={onModel} disabled={disabled || thinking} /> : <span className="model-label">Model · CLI policy</span>}<Button variant="primary" aria-label={thinking ? 'Cancel response' : 'Send'} disabled={disabled || busy} onClick={() => thinking ? void onCancel() : void send()}>{thinking ? <Square size={15} fill="currentColor" /> : busy ? <Spinner label="" /> : <Send size={16} />}</Button></div>{error ? <p className="composer-error">{error}</p> : null}</div>;
}

function TypingIndicator() { const [dots, setDots] = useState(1); useEffect(() => { const timer = window.setInterval(() => setDots(current => current === 3 ? 1 : current + 1), 420); return () => window.clearInterval(timer); }, []); return <div className="typing-indicator" aria-live="polite"><span>Thinking</span><strong>{'.'.repeat(dots)}</strong></div>; }
function ElapsedTime({ timing, fallback }: { timing?: { startedAt: number; endedAt?: number }; fallback: string }) { const startedAt = timing?.startedAt ?? Date.parse(fallback); const [now, setNow] = useState(Date.now()); useEffect(() => { if (timing?.endedAt !== undefined) return; const timer = window.setInterval(() => setNow(Date.now()), 1_000); return () => window.clearInterval(timer); }, [timing?.endedAt]); const end = timing?.endedAt ?? (timing ? now : startedAt); return <div className="worked-time">Worked for {formatDuration(Math.max(0, end - startedAt))}</div>; }

function CopyTextButton({ content, label }: { content: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const resetTimer = useRef<number | undefined>();
  useEffect(() => () => { if (resetTimer.current !== undefined) window.clearTimeout(resetTimer.current); }, []);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      if (resetTimer.current !== undefined) window.clearTimeout(resetTimer.current);
      resetTimer.current = window.setTimeout(() => setCopied(false), 1_500);
    } catch {
      setCopied(false);
    }
  };
  return <Tooltip label={copied ? 'Copied' : label}><button type="button" className="agent-copy-button" aria-label={label} onClick={() => void copy()}>{copied ? <Check size={13} /> : <Copy size={13} />}</button></Tooltip>;
}

function ChangeSummaryChip({ summary, onClick }: { summary: FileChangeSummary; onClick: () => void }) {
  return <button type="button" className="change-summary-chip" onClick={onClick}><span className="change-summary-step" aria-hidden="true" /><span>{summary.files.length} {summary.files.length === 1 ? 'file' : 'files'} changed</span><span className="change-additions">+{summary.additions}</span><span className="change-deletions">-{summary.deletions}</span></button>;
}

function FileChangesDrawer({ summary, onClose }: { summary: FileChangeSummary; onClose: () => void }) {
  return <aside className="file-changes-drawer" aria-label="Changed files"><header><div><strong>Changed files</strong><span>{summary.files.length} files · +{summary.additions} -{summary.deletions}</span></div><button type="button" className="icon-button" aria-label="Close changed files" onClick={onClose}><X size={16} /></button></header><div className="file-changes-list">{summary.files.map(change => <FileChangeItem key={change.path} change={change} />)}</div></aside>;
}

function FileChangeCard({ summary, onOpenFileChanges }: { summary: FileChangeSummary; onOpenFileChanges: (summary: FileChangeSummary) => void }) {
  return <section className="file-change-card" aria-label="Edited files"><header><div><strong>Edited {summary.files.length} {summary.files.length === 1 ? 'file' : 'files'}</strong><span><b className="change-additions">+{summary.additions}</b><b className="change-deletions">-{summary.deletions}</b></span></div></header><div className="file-change-card-list">{summary.files.map(change => <FileChangeItem key={change.path} change={change} onOpenFileChanges={() => onOpenFileChanges(summary)} />)}</div></section>;
}

function FileChangeItem({ change, onOpenFileChanges }: { change: FileChangeDiff; onOpenFileChanges?: () => void }) {
  const [expanded, setExpanded] = useState(true);
  return <section className="file-change-item"><header><button type="button" className="file-change-toggle" aria-label={`${expanded ? 'Collapse' : 'Expand'} changes for ${change.path}`} aria-expanded={expanded} onClick={() => setExpanded(current => !current)}>{expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</button>{onOpenFileChanges ? <button type="button" className="file-change-path" title={change.path} onClick={onOpenFileChanges}>{change.path}</button> : <strong title={change.path}>{change.path}</strong>}<span><Plus size={12} />{change.additions}<Minus size={12} />{change.deletions}</span></header>{expanded ? <pre>{change.lines.map((line, index) => <code className={`diff-line diff-${line.kind}`} key={`${change.path}:${index}`}><span className="diff-line-number">{line.newLine ?? line.oldLine ?? ''}</span><span>{line.kind === 'addition' ? '+' : line.kind === 'deletion' ? '-' : ' '}{line.text}</span></code>)}{change.truncated ? <code className="diff-truncated">… diff truncated …</code> : null}</pre> : null}</section>;
}
function toMessage(reason: unknown): string { return reason instanceof Error ? reason.message : 'The workspace operation failed.'; }
