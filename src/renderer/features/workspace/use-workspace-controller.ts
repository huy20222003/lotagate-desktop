import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DESKTOP_COMMAND_TIMING_METADATA_KEY, type Activity, type Artifact, type FileChangeSummary, type PlanSnapshot, type SubagentSnapshot, type Task, type TrustRequest, type Workspace } from '../../../contracts/ipc/v1/workspace.js';
import type { DesktopApprovalRequest } from '../../../contracts/ipc/v1/approval.js';
import { sessionSlugFromPrompt } from './task-title.js';
import { shouldAutoApproveDesktop, type ApprovalMode } from './approval-policy.js';
import { EMPTY_FILE_CHANGE_SUMMARIES, EMPTY_FILE_CHANGE_SUMMARY, fileChangeSummariesFromActivities, mergeFileChange, mergeFileChangeForTurn, mergeFileChangeSummaries } from './file-changes.js';
import { applyPlanEvent, applySubagentEvent } from './orchestration-events.js';
import { readSelectedModel, writeSelectedModel } from './model-preference.js';
import { MessageQueueService, useMessageQueue, type QueuedMessage } from './message-queue-service.js';
import type { PromptSendOptions } from './prompt-options.js';
import type { AttachmentPreview } from './attachment-types.js';
import { executeDesktopCommandResult, type DesktopCommandInvocation } from '../../services/desktop-command-client.js';
import { extractWorkspaceModels, type WorkspaceModelOption } from './model-catalog.js';
import { toUserErrorMessage as toMessage } from '../../utils/errors.js';
import { agentStatusForEvent, commandStatusForAction } from './agent-status.js';
import { turnTimingsFromActivities } from './turn-timings.js';
import { appendAssistantDelta, assistantStreamKey, isAssistantStreamPersisted, reconcilePendingAssistantStreams, type PendingAssistantStream } from './streaming-activity.js';
import { discardQueuedAttachments, extractSessionId, extractTurnId, loadActivityArtifactPreviews, loadActivityAttachmentPreviews, loadAttachmentPreviews, mergeActivities } from './workspace-controller-helpers.js';
import { allowsUnscopedTaskFallback } from './agent-event-routing.js';
import { persistDesktopCommandResult } from './desktop-command-result-persistence.js';
import { cancelWorkspaceTask } from './cancel-workspace-task.js';

type ContextCompactionPhase = 'compacting' | 'compacted' | 'failed';

export function useWorkspaceController() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspace, setWorkspace] = useState<Workspace | undefined>();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [task, setTask] = useState<Task | undefined>();
  const [activities, setActivities] = useState<Activity[]>([]);
  const [activitiesLoading, setActivitiesLoading] = useState(false);
  const [hasOlderActivities, setHasOlderActivities] = useState(false);
  const [loadingOlderActivities, setLoadingOlderActivities] = useState(false);
  const [activityAttachments, setActivityAttachments] = useState<Record<string, AttachmentPreview[]>>({});
  const [activityArtifacts, setActivityArtifacts] = useState<Record<string, Artifact[]>>({});
  const [fileChanges, setFileChanges] = useState<FileChangeSummary>(EMPTY_FILE_CHANGE_SUMMARY);
  const [fileChangesByTurn, setFileChangesByTurn] = useState(EMPTY_FILE_CHANGE_SUMMARIES);
  const [plan, setPlan] = useState<PlanSnapshot | undefined>();
  const [subagents, setSubagents] = useState<SubagentSnapshot[]>([]);
  const [attachments, setAttachments] = useState<AttachmentPreview[]>([]);
  const [approval, setApproval] = useState<DesktopApprovalRequest | undefined>();
  const [approvalMode, setApprovalMode] = useState<ApprovalMode>('auto');
  const [trust, setTrust] = useState<TrustRequest | undefined>();
  const [models, setModels] = useState<WorkspaceModelOption[]>([]);
  const [selectedModel, setSelectedModelValue] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [thinkingStartedAt, setThinkingStartedAt] = useState<number | undefined>();
  const [agentStatus, setAgentStatus] = useState<string | undefined>();
  const [contextCompactionStatus, setContextCompactionStatus] = useState<ContextCompactionPhase | undefined>();
  const [turnTimings, setTurnTimings] = useState<Record<string, { startedAt: number; endedAt?: number }>>({});
  const [error, setError] = useState<string | undefined>();
  const draftTaskRef = useRef<Task | undefined>();
  const draftTaskPromiseRef = useRef<Promise<Task | undefined>>();
  const taskReloadRequestRef = useRef(0);
  const taskReloadTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>();
  const initialTasksLoadedRef = useRef(false);
  const activityRequestRef = useRef(0);
  const activityRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>();
  const pendingAssistantStreamsRef = useRef(new Map<string, PendingAssistantStream>());
  const activitiesRef = useRef<Activity[]>([]);
  const activityPageCursorRef = useRef<string | null>(null);
  const loadingOlderActivitiesRef = useRef(false);
  const activeTurnRef = useRef<{ taskId: string; cwd: string; turnId: string } | undefined>();
  const workspaceRef = useRef<Workspace | undefined>();
  const tasksRef = useRef<Task[]>([]);
  const messageQueueServiceRef = useRef(new MessageQueueService());
  const queuedMessages = useMessageQueue(messageQueueServiceRef.current);
  const sendPromptRef = useRef<(prompt: string, options?: PromptSendOptions) => Promise<void>>();
  const dispatchQueuedPromptRef = useRef<(message: QueuedMessage) => Promise<void>>();
  const steeringQueueIdRef = useRef<string | undefined>();
  const suppressQueueRef = useRef(false);
  useEffect(() => { draftTaskRef.current = task; }, [task]);
  useEffect(() => { workspaceRef.current = workspace; tasksRef.current = tasks; }, [tasks, workspace]);
  useEffect(() => { void window.lotagate.settings.get().then(settings => { setApprovalMode(settings.approvalMode); }).catch(() => undefined); }, []);
  useEffect(() => {
    const unsubscribe = window.lotagate.approvals.onRequest(request => {
      if (request.surface !== 'composer' || request.source === 'automation') return;
      if (request.workspaceCwd !== undefined && request.workspaceCwd !== workspace?.rootPath) return;
      if (shouldAutoApproveDesktop(request, approvalMode)) { void window.lotagate.approvals.respond(request.approvalId, true).catch(reason => setError(toMessage(reason))); return; }
      setApproval(request);
    });
    return unsubscribe;
  }, [approvalMode, workspace?.rootPath]);
  useEffect(() => window.lotagate.approvals.onResolved(resolution => {
    setApproval(current => current?.approvalId === resolution.approvalId ? undefined : current);
  }), []);
  const updateApprovalMode = useCallback((next: ApprovalMode) => {
    setApprovalMode(next);
    void window.lotagate.settings.update({ approvalMode: next }).catch(() => undefined);
  }, []);
  const showContextCompactionStatus = useCallback((phase: ContextCompactionPhase | undefined) => {
    setContextCompactionStatus(phase);
  }, []);

  const reloadTasks = useCallback(async (workspaceId: string) => {
    const requestId = ++taskReloadRequestRef.current;
    const next = await window.lotagate.tasks.list(workspaceId);
    if (requestId !== taskReloadRequestRef.current) return;
    setTasks(current => [...current.filter(item => item.workspaceId !== workspaceId), ...next]);
    setTask(current => {
      if (current === undefined || current.workspaceId !== workspaceId) return current;
      return next.find(item => item.id === current.id && !item.archived) ?? next.find(item => !item.archived);
    });
  }, []);

  const scheduleTaskReload = useCallback((workspaceId: string) => {
    if (taskReloadTimerRef.current !== undefined) return;
    taskReloadTimerRef.current = setTimeout(() => {
      taskReloadTimerRef.current = undefined;
      void reloadTasks(workspaceId).catch(reason => setError(toMessage(reason)));
    }, 75);
  }, [reloadTasks]);

  useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        const nextWorkspaces = await window.lotagate.workspaces.list();
        const nextTasks = (await Promise.all(nextWorkspaces.map(item => window.lotagate.tasks.list(item.id)))).flat();
        if (!mounted) return;
        const preferredWorkspace = nextWorkspaces.find(item => item.trusted) ?? nextWorkspaces[0];
        setWorkspaces(nextWorkspaces);
        setTasks(nextTasks);
        setWorkspace(preferredWorkspace);
        setTask(preferredWorkspace === undefined ? undefined : nextTasks.find(item => item.workspaceId === preferredWorkspace.id && !item.archived));
      } catch (reason) {
        if (mounted) setError(toMessage(reason));
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    if (!workspace) return;
    if (!initialTasksLoadedRef.current) { initialTasksLoadedRef.current = true; return; }
    void reloadTasks(workspace.id).catch(reason => setError(toMessage(reason)));
  }, [workspace, reloadTasks]);
  useEffect(() => {
    if (!workspace) return;
    void window.lotagate.agent.initialize(workspace.rootPath).then(async () => {
      const modelValue = await window.lotagate.agent.modelList(workspace.rootPath);
      const next = extractWorkspaceModels(modelValue);
      setModels(next);
    }).catch(() => undefined);
  }, [workspace]);
  useEffect(() => {
    if (models.length === 0) return;
    const preferred = task?.model ?? readSelectedModel();
    const next = preferred !== undefined && models.some(model => model.id === preferred) ? preferred : models[0]?.id ?? '';
    setSelectedModelValue(current => current === next ? current : next);
  }, [models, task?.id, task?.model]);
  const loadActivities = useCallback(async (taskId: string, reset = true): Promise<void> => {
    const requestId = ++activityRequestRef.current;
    const page = await window.lotagate.tasks.activitiesPage(taskId);
    const persisted = reset ? page.activities : mergeActivities(activitiesRef.current.filter(activity => activity.taskId === taskId), page.activities);
    const pending = new Map(pendingAssistantStreamsRef.current);
    for (const [key, stream] of pending) if (stream.taskId === taskId && isAssistantStreamPersisted(persisted, stream)) pending.delete(key);
    pendingAssistantStreamsRef.current = pending;
    const next = reconcilePendingAssistantStreams(persisted, [...pending.values()].filter(stream => stream.taskId === taskId));
    const nextActivityAttachments = await loadActivityAttachmentPreviews(taskId, next);
    const nextActivityArtifacts = await loadActivityArtifactPreviews(taskId, next);
    if (requestId === activityRequestRef.current) {
      const summaries = fileChangeSummariesFromActivities(next);
      activitiesRef.current = next;
      setActivities(next);
      if (reset || activityPageCursorRef.current === null || activitiesRef.current.length === 0) {
        activityPageCursorRef.current = page.nextCursor;
        setHasOlderActivities(page.hasMore);
      }
      setTurnTimings(turnTimingsFromActivities(next));
      setActivityAttachments(nextActivityAttachments);
      setActivityArtifacts(nextActivityArtifacts);
      setFileChangesByTurn(current => mergeFileChangeSummaries(current, summaries));
      const liveTurnId = activeTurnRef.current?.turnId;
      if (liveTurnId === undefined) setFileChanges(EMPTY_FILE_CHANGE_SUMMARY);
      else setFileChanges(current => summaries[liveTurnId] === undefined ? current : mergeFileChangeSummaries({ [liveTurnId]: current }, summaries)[liveTurnId] ?? current);
    }
  }, []);

  const scheduleActivityRefresh = useCallback((taskId: string) => {
    if (activityRefreshTimerRef.current !== undefined) return;
    activityRefreshTimerRef.current = setTimeout(() => {
      activityRefreshTimerRef.current = undefined;
      void loadActivities(taskId, false).catch(reason => setError(toMessage(reason)));
    }, 75);
  }, [loadActivities]);

  const loadOlderActivities = useCallback(async (): Promise<boolean> => {
    const taskId = task?.id;
    const before = activityPageCursorRef.current;
    if (taskId === undefined || before === null || !hasOlderActivities || loadingOlderActivitiesRef.current) return false;
    loadingOlderActivitiesRef.current = true;
    setLoadingOlderActivities(true);
    const requestId = activityRequestRef.current;
    try {
      const page = await window.lotagate.tasks.activitiesPage(taskId, { before });
      if (requestId !== activityRequestRef.current || draftTaskRef.current?.id !== taskId) return false;
      const persisted = mergeActivities(activitiesRef.current.filter(activity => activity.taskId === taskId), page.activities);
      const pending = [...pendingAssistantStreamsRef.current.values()].filter(stream => stream.taskId === taskId);
      const next = reconcilePendingAssistantStreams(persisted, pending);
      const nextActivityAttachments = await loadActivityAttachmentPreviews(taskId, next);
      const nextActivityArtifacts = await loadActivityArtifactPreviews(taskId, next);
      if (requestId !== activityRequestRef.current || draftTaskRef.current?.id !== taskId) return false;
      const summaries = fileChangeSummariesFromActivities(next);
      activitiesRef.current = next;
      setActivities(next);
      setTurnTimings(turnTimingsFromActivities(next));
      setActivityAttachments(nextActivityAttachments);
      setActivityArtifacts(nextActivityArtifacts);
      setFileChangesByTurn(current => mergeFileChangeSummaries(current, summaries));
      activityPageCursorRef.current = page.nextCursor;
      setHasOlderActivities(page.hasMore);
      return page.activities.length > 0;
    } finally {
      loadingOlderActivitiesRef.current = false;
      setLoadingOlderActivities(false);
    }
  }, [hasOlderActivities, task?.id]);

  useEffect(() => {
    let mounted = true;
    activityRequestRef.current += 1;
    if (!task) { activitiesRef.current = []; activityPageCursorRef.current = null; pendingAssistantStreamsRef.current.clear(); setActivities([]); setHasOlderActivities(false); setLoadingOlderActivities(false); setTurnTimings({}); setActivityAttachments({}); setActivityArtifacts({}); setFileChanges(EMPTY_FILE_CHANGE_SUMMARY); setFileChangesByTurn(EMPTY_FILE_CHANGE_SUMMARIES); setPlan(undefined); setSubagents([]); setAttachments([]); setActivitiesLoading(false); return; }
    activityPageCursorRef.current = null;
    setHasOlderActivities(false);
    setActivitiesLoading(true);
    void loadActivities(task.id, true).catch(reason => { if (mounted) setError(toMessage(reason)); }).finally(() => { if (mounted) setActivitiesLoading(false); });
    void loadAttachmentPreviews(task.id, task.draftAttachmentIds).then(next => { if (mounted) setAttachments(next); }).catch(() => { if (mounted) setAttachments([]); });
    return () => {
      mounted = false;
      if (activityRefreshTimerRef.current !== undefined) { clearTimeout(activityRefreshTimerRef.current); activityRefreshTimerRef.current = undefined; }
    };
  }, [loadActivities, task?.id]);

  useEffect(() => () => {
    if (taskReloadTimerRef.current !== undefined) { clearTimeout(taskReloadTimerRef.current); taskReloadTimerRef.current = undefined; }
  }, [workspace?.id]);

  useEffect(() => window.lotagate.agent.onEvent(envelope => {
    const currentWorkspace = workspaceRef.current;
    const currentTasks = tasksRef.current;
    const currentTask = draftTaskRef.current;
    if (currentWorkspace === undefined || envelope.cwd !== currentWorkspace.rootPath) return;
    const data = envelope.event.data;
    const terminal = envelope.event.event === 'turn.completed' || envelope.event.event === 'turn.failed' || envelope.event.event === 'turn.cancelled';
    const eventSessionId = typeof data['sessionId'] === 'string' ? data['sessionId'] : undefined;
    const turnId = typeof data['turnId'] === 'string' ? data['turnId'] : undefined;
    const currentTaskId = currentTask?.id;
    const allowUnscopedFallback = allowsUnscopedTaskFallback(envelope.event.event, eventSessionId, turnId);
    const eventTask = currentTasks.find(item => eventSessionId !== undefined && item.sessionId === eventSessionId) ?? (currentTask?.sessionId === eventSessionId ? currentTask : undefined) ?? (allowUnscopedFallback ? currentTask : undefined) ?? (allowUnscopedFallback && currentTasks.length === 1 ? currentTasks[0] : undefined);
    if (eventTask !== undefined && eventTask.id === currentTaskId) {
      if (turnId && envelope.event.event === 'turn.started') setTurnTimings(current => ({ ...current, [turnId]: { startedAt: Date.now() } }));
      if (turnId && terminal) setTurnTimings(current => ({ ...current, [turnId]: { startedAt: current[turnId]?.startedAt ?? Date.now(), endedAt: Date.now() } }));
      if (turnId && envelope.event.event === 'turn.started') activeTurnRef.current = { taskId: eventTask.id, cwd: currentWorkspace.rootPath, turnId };
      const currentTurn = turnId === undefined || activeTurnRef.current?.turnId === turnId;
      if (terminal && currentTurn) activeTurnRef.current = undefined;
      const status = agentStatusForEvent(envelope.event.event, data);
      if (envelope.event.event === 'turn.started') { setAgentStatus(undefined); setContextCompactionStatus(undefined); }
      else if (status !== undefined) setAgentStatus(status);
      if (envelope.event.event === 'turn.started') {
        setThinking(true);
        setThinkingStartedAt(current => current ?? Date.now());
      }
      if (terminal && currentTurn) {
        setAgentStatus(undefined);
        setThinking(false); setThinkingStartedAt(undefined);
        const steeredId = steeringQueueIdRef.current;
        const shouldDrain = !suppressQueueRef.current && (envelope.event.event !== 'turn.cancelled' || steeredId !== undefined);
        const queued = shouldDrain ? (steeredId === undefined ? messageQueueServiceRef.current.takeFirst() : messageQueueServiceRef.current.remove(steeredId)) : undefined;
        steeringQueueIdRef.current = undefined;
        suppressQueueRef.current = false;
        if (queued) window.setTimeout(() => { void dispatchQueuedPromptRef.current?.(queued); }, 0);
      }
    }
    if (eventTask !== undefined && eventTask.id === currentTaskId) {
      if (envelope.event.event === 'trust.requested') setTrust({ trustRequestId: String(data['trustRequestId']), taskId: eventTask.id, sessionId: String(data['sessionId']), path: String(data['path']) });
      if (envelope.event.event === 'file.changed') {
        setFileChanges(current => mergeFileChange(current, data['change']));
        if (turnId !== undefined) setFileChangesByTurn(current => mergeFileChangeForTurn(current, turnId, data['change']));
      }
      if (envelope.event.event === 'assistant.delta' && typeof data['content'] === 'string' && data['content'].length > 0) {
        const input = { taskId: eventTask.id, ...(turnId === undefined ? {} : { turnId }), content: data['content'], createdAt: new Date().toISOString() };
        const nextActivities = appendAssistantDelta(activitiesRef.current, input);
        const streamed = nextActivities.find(activity => activity.id === `streaming:${eventTask.id}:${turnId ?? 'active'}`)
          ?? [...nextActivities].reverse().find(activity => activity.taskId === eventTask.id && activity.kind === 'assistant' && activity.metadata['turnId'] === turnId);
        if (streamed !== undefined) pendingAssistantStreamsRef.current.set(assistantStreamKey(eventTask.id, turnId), { taskId: eventTask.id, ...(turnId === undefined ? {} : { turnId }), text: streamed.text, createdAt: streamed.createdAt });
        activitiesRef.current = nextActivities;
        setActivities(nextActivities);
      }
      if (envelope.event.event === 'context.compacting') showContextCompactionStatus('compacting');
      if (envelope.event.event === 'context.compacted') showContextCompactionStatus('compacted');
      if (envelope.event.event.startsWith('subagent.')) setSubagents(current => applySubagentEvent(current, envelope.event.event, data));
      if (envelope.event.event.startsWith('plan.')) setPlan(current => applyPlanEvent(current, envelope.event.event, data));
    }
    if (eventTask !== undefined && eventTask.id === currentTaskId) scheduleActivityRefresh(eventTask.id);
    if (eventTask !== undefined) scheduleTaskReload(currentWorkspace.id);
  }), [scheduleActivityRefresh, scheduleTaskReload]);

  const selectWorkspace = useCallback((next: Workspace) => {
    void discardQueuedAttachments(task?.id, messageQueueServiceRef.current.snapshot(), activities, task?.draftAttachmentIds ?? []);
    setWorkspace(next);
    const nextTask = tasks.find(item => item.workspaceId === next.id && !item.archived);
    draftTaskRef.current = nextTask;
    setTask(current => current?.workspaceId === next.id ? current : nextTask);
    setApproval(undefined); setTrust(undefined); setAgentStatus(undefined); showContextCompactionStatus(undefined); setPlan(undefined); setSubagents([]); setFileChangesByTurn(EMPTY_FILE_CHANGE_SUMMARIES); messageQueueServiceRef.current.clear(); steeringQueueIdRef.current = undefined;
  }, [activities, showContextCompactionStatus, task, tasks]);
  const selectTask = useCallback((next: Task) => {
    void discardQueuedAttachments(task?.id, messageQueueServiceRef.current.snapshot(), activities, task?.draftAttachmentIds ?? []);
    setWorkspace(current => workspaces.find(item => item.id === next.workspaceId) ?? current);
    draftTaskRef.current = next;
    setTask(next);
    setApproval(undefined); messageQueueServiceRef.current.clear(); steeringQueueIdRef.current = undefined;
    setTrust(undefined); setAgentStatus(undefined); showContextCompactionStatus(undefined); setPlan(undefined); setSubagents([]); setFileChangesByTurn(EMPTY_FILE_CHANGE_SUMMARIES);
    if (next.sessionId) void window.lotagate.agent.sessionResume(next.cwd, next.sessionId).catch(reason => setError(toMessage(reason)));
  }, [activities, showContextCompactionStatus, task, workspaces]);
  const newTask = useCallback(async (targetWorkspace?: Workspace) => {
    const target = targetWorkspace ?? workspace;
    if (target === undefined) return;
    setBusy(true); setError(undefined); setThinking(false); setThinkingStartedAt(undefined); setAgentStatus(undefined); showContextCompactionStatus(undefined); setWorkspace(target); setApproval(undefined); setTrust(undefined);
    try {
      const created = await window.lotagate.tasks.create({ workspaceId: target.id, title: 'New chat' });
      setTasks(current => [created, ...current]);
      const handshake = await window.lotagate.agent.initialize(target.rootPath);
      if (!handshake) throw new Error('CLI handshake failed.');
      const session = await window.lotagate.agent.sessionCreate(target.rootPath, { name: created.title });
      const sessionId = extractSessionId(session);
      if (sessionId === undefined) throw new Error('CLI did not return a session id.');
      const next = await window.lotagate.tasks.update(created.id, { sessionId });
      setTasks(current => current.map(item => item.id === next.id ? next : item));
      setTask(next);
    } catch (reason) { setError(toMessage(reason)); throw reason; }
    finally { setBusy(false); }
  }, [showContextCompactionStatus, workspace]);

  const addWorkspace = useCallback(async (rootPath: string) => { const next = await window.lotagate.workspaces.add(rootPath); setWorkspaces(current => [...current.filter(item => item.id !== next.id), next]); setWorkspace(next); setTask(undefined); return next; }, []);
  const trustWorkspace = useCallback(async (workspaceId: string, trusted: boolean) => {
    const updated = await window.lotagate.workspaces.trust(workspaceId, trusted);
    setWorkspaces(current => current.map(item => item.id === updated.id ? updated : item));
    setWorkspace(current => current?.id === updated.id ? updated : current);
    return updated;
  }, []);
  const renameWorkspace = useCallback(async (workspaceId: string, name: string) => {
    const updated = await window.lotagate.workspaces.rename(workspaceId, name);
    setWorkspaces(current => current.map(item => item.id === updated.id ? updated : item));
    setWorkspace(current => current?.id === updated.id ? updated : current);
  }, []);
  const renameTask = useCallback(async (taskId: string, title: string) => {
    const updated = await window.lotagate.tasks.update(taskId, { title });
    setTasks(current => current.map(item => item.id === updated.id ? updated : item));
    setTask(current => current?.id === updated.id ? updated : current);
  }, []);
  const removeWorkspace = useCallback(async (workspaceId: string) => {
    await window.lotagate.workspaces.remove(workspaceId);
    setWorkspaces(current => current.filter(item => item.id !== workspaceId));
    setTasks(current => current.filter(item => item.workspaceId !== workspaceId));
    setWorkspace(current => current?.id === workspaceId ? undefined : current);
    setTask(current => current?.workspaceId === workspaceId ? undefined : current);
    activitiesRef.current = []; activityPageCursorRef.current = null; pendingAssistantStreamsRef.current.clear(); setActivities([]); setHasOlderActivities(false); setLoadingOlderActivities(false); setApproval(undefined); setTrust(undefined); setAgentStatus(undefined); showContextCompactionStatus(undefined); setThinking(false); setThinkingStartedAt(undefined);
  }, [showContextCompactionStatus]);
  const createTask = useCallback(async (prompt: string) => {
    if (workspace === undefined) throw new Error('Select a workspace first.');
    const title = sessionSlugFromPrompt(prompt);
    const created = await window.lotagate.tasks.create({ workspaceId: workspace.id, title, prompt });
    setTasks(current => [created, ...current]); setTask(created); return created;
  }, [workspace]);

  const startPrompt = useCallback(async (prompt: string, attachmentIdsOverride?: readonly string[], options?: PromptSendOptions): Promise<boolean> => {
    if (!prompt.trim() || workspace === undefined) return false;
    setBusy(true); setError(undefined); setFileChanges(EMPTY_FILE_CHANGE_SUMMARY); setPlan(undefined); setSubagents([]);
    let failedTaskId: string | undefined;
    try {
      const isNewTask = task === undefined;
      let activeTask = task ?? await createTask(prompt);
      failedTaskId = activeTask.id;
      draftTaskRef.current = activeTask;
      const attachmentIds = [...(attachmentIdsOverride ?? activeTask.draftAttachmentIds)];
      if (!isNewTask) await window.lotagate.tasks.addActivity(activeTask.id, 'user', prompt, attachmentIds.length === 0 ? {} : { attachmentIds });
      await loadActivities(activeTask.id, isNewTask);
      const patch: { draft: string; draftAttachmentIds: string[]; title?: string } = { draft: '', draftAttachmentIds: [] };
      if (activeTask.title === 'New chat') {
        patch.title = sessionSlugFromPrompt(prompt);
      }
      activeTask = await window.lotagate.tasks.update(activeTask.id, patch);
      draftTaskRef.current = activeTask;
      setTask(activeTask);
      setAttachments([]);
      const handshake = await window.lotagate.agent.initialize(activeTask.cwd);
      const session = activeTask.sessionId ? await window.lotagate.agent.sessionResume(activeTask.cwd, activeTask.sessionId) : await window.lotagate.agent.sessionCreate(activeTask.cwd, { name: activeTask.title });
      const sessionId = activeTask.sessionId ?? extractSessionId(session);
      if (sessionId === undefined) throw new Error('CLI did not return a session id.');
      activeTask = await window.lotagate.tasks.update(activeTask.id, { sessionId });
      draftTaskRef.current = activeTask;
      setTask(activeTask);
      setTasks(current => current.map(item => item.id === activeTask.id ? activeTask : item));
      const model = selectedModel || activeTask.model;
      if (model && activeTask.model !== model) await window.lotagate.tasks.update(activeTask.id, { model });
      setThinking(true); setThinkingStartedAt(Date.now()); setAgentStatus(undefined);
      const turn = await window.lotagate.agent.turnStart(activeTask.cwd, { sessionId, prompt: options?.agentPrompt ?? prompt, taskId: activeTask.id, ...(model ? { model } : {}), ...(options?.skills === undefined ? {} : { skills: [...options.skills] }), ...(attachmentIds.length === 0 ? {} : { attachmentIds }) });
      const turnId = extractTurnId(turn);
      if (turnId) {
        activeTurnRef.current = { taskId: activeTask.id, cwd: activeTask.cwd, turnId };
        setTurnTimings(current => ({ ...current, [turnId]: { startedAt: current[turnId]?.startedAt ?? Date.now() } }));
        const updatedTask = await window.lotagate.tasks.update(activeTask.id, { turnId });
        draftTaskRef.current = updatedTask;
        setTask(updatedTask);
        setTasks(current => current.map(item => item.id === updatedTask.id ? updatedTask : item));
      }
      if (!handshake) throw new Error('CLI handshake failed.');
      await reloadTasks(workspace.id);
      return true;
    } catch (reason) {
      setThinking(false); setThinkingStartedAt(undefined); setAgentStatus(undefined); setError(toMessage(reason));
      if (failedTaskId) {
        if (activeTurnRef.current?.taskId === failedTaskId) activeTurnRef.current = undefined;
        await window.lotagate.tasks.setStatus(failedTaskId, 'failed');
      }
      return false;
    }
    finally { setBusy(false); }
  }, [createTask, loadActivities, reloadTasks, selectedModel, task, workspace]);
  const enqueuePrompt = useCallback(async (prompt: string, options?: PromptSendOptions) => {
    const activeTask = draftTaskRef.current ?? task;
    if (!activeTask) return;
    try {
      const queuedAttachments = await loadAttachmentPreviews(activeTask.id, activeTask.draftAttachmentIds);
      const next = await window.lotagate.tasks.update(activeTask.id, { draft: '', draftAttachmentIds: [] });
      draftTaskRef.current = next;
      setTask(next);
      setTasks(current => current.map(item => item.id === next.id ? next : item));
      setAttachments([]);
      messageQueueServiceRef.current.enqueue(prompt.trim(), queuedAttachments, options);
    } catch (reason) {
      setError(toMessage(reason));
    }
  }, [task]);
  const sendPrompt = useCallback(async (prompt: string, options?: PromptSendOptions) => {
    if (!prompt.trim() || workspace === undefined) return;
    if (activeTurnRef.current?.taskId === task?.id) { await enqueuePrompt(prompt, options); return; }
    await startPrompt(prompt, undefined, options);
  }, [enqueuePrompt, startPrompt, task, workspace]);
  const runCommand = useCallback(async (invocation: DesktopCommandInvocation, preview: string): Promise<boolean> => {
    if (!workspace || !preview.trim()) return false;
    if (activeTurnRef.current?.taskId === task?.id) {
      setError('Wait for the active response to finish before running a slash command.');
      return false;
    }
    setBusy(true); setError(undefined); setFileChanges(EMPTY_FILE_CHANGE_SUMMARY); setPlan(undefined); setSubagents([]); setAgentStatus(commandStatusForAction(invocation.actionId) ?? 'Running command…');
    const commandStartedAt = Date.now();
    setThinking(true); setThinkingStartedAt(commandStartedAt);
    try {
      const isNewTask = task === undefined;
      let activeTask = task ?? await createTask(preview);
      draftTaskRef.current = activeTask;
      if (!isNewTask) await window.lotagate.tasks.addActivity(activeTask.id, 'user', preview, { command: invocation.actionId });
      activeTask = await window.lotagate.tasks.update(activeTask.id, { draft: '', draftAttachmentIds: [], ...(activeTask.title === 'New chat' ? { title: sessionSlugFromPrompt(preview) } : {}) });
      draftTaskRef.current = activeTask;
      setTask(activeTask); setAttachments([]);
      await loadActivities(activeTask.id, isNewTask);
      await window.lotagate.tasks.setStatus(activeTask.id, 'active');
      await window.lotagate.agent.initialize(activeTask.cwd);
      const result = await executeDesktopCommandResult(activeTask.cwd, invocation);
      const commandEndedAt = Date.now();
      const mediaImportFailures = await persistDesktopCommandResult(activeTask.id, invocation.actionId, result, commandStartedAt, commandEndedAt);
      if (mediaImportFailures > 0) setError(`Command completed, but ${mediaImportFailures} media file${mediaImportFailures === 1 ? '' : 's'} could not be imported.`);
      await window.lotagate.tasks.setStatus(activeTask.id, 'completed');
      await reloadTasks(workspace.id);
      await loadActivities(activeTask.id, isNewTask);
      return true;
    } catch (reason) {
      const failedTask = draftTaskRef.current ?? task;
      if (failedTask) {
        const commandEndedAt = Date.now();
        await window.lotagate.tasks.addActivity(failedTask.id, 'error', toMessage(reason), { command: invocation.actionId, [DESKTOP_COMMAND_TIMING_METADATA_KEY]: { startedAt: commandStartedAt, endedAt: commandEndedAt } }).catch(() => undefined);
        await window.lotagate.tasks.setStatus(failedTask.id, 'failed').catch(() => undefined);
      }
      setError(toMessage(reason));
      return false;
    } finally { setBusy(false); setThinking(false); setThinkingStartedAt(undefined); setAgentStatus(undefined); }
  }, [createTask, loadActivities, reloadTasks, task, workspace]);
  const dispatchQueuedPrompt = useCallback(async (message: QueuedMessage) => {
    const started = await startPrompt(message.prompt, message.attachments.map(attachment => attachment.id), message.options);
    if (!started) messageQueueServiceRef.current.prepend(message);
  }, [startPrompt]);
  useEffect(() => { sendPromptRef.current = sendPrompt; }, [sendPrompt]);
  useEffect(() => { dispatchQueuedPromptRef.current = dispatchQueuedPrompt; }, [dispatchQueuedPrompt]);
  const selectModel = useCallback((model: string) => {
    setSelectedModelValue(model);
    writeSelectedModel(model);
    const activeTask = draftTaskRef.current ?? task;
    if (!activeTask || activeTask.model === model) return;
    void window.lotagate.tasks.update(activeTask.id, { model }).then(updated => {
      draftTaskRef.current = updated;
      setTask(current => current?.id === updated.id ? updated : current);
      setTasks(current => current.map(item => item.id === updated.id ? updated : item));
    }).catch(() => undefined);
  }, [task]);

  const respondApproval = useCallback(async (approved: boolean) => {
    if (!approval || workspace === undefined) return;
    await window.lotagate.approvals.respond(approval.approvalId, approved);
    setApproval(undefined);
  }, [approval, workspace]);
  const respondTrust = useCallback(async (trusted: boolean) => { if (!trust || workspace === undefined) return; await window.lotagate.agent.trustRespond(workspace.rootPath, { trustRequestId: trust.trustRequestId, trusted }); if (trusted) { const updated = await window.lotagate.workspaces.trust(workspace.id, true); setWorkspace(updated); setWorkspaces(current => current.map(item => item.id === updated.id ? updated : item)); } setTrust(undefined); }, [trust, workspace]);
  const ensureDraftTask = useCallback(async (): Promise<Task | undefined> => {
    if (task) { draftTaskRef.current = task; return task; }
    if (draftTaskRef.current) return draftTaskRef.current;
    if (workspace === undefined) return undefined;
    if (draftTaskPromiseRef.current) return draftTaskPromiseRef.current;
    const promise = window.lotagate.tasks.create({ workspaceId: workspace.id, title: 'New chat' }).then(created => {
      draftTaskRef.current = created;
      setTasks(current => current.some(item => item.id === created.id) ? current : [created, ...current]);
      setTask(created);
      return created;
    }).finally(() => { draftTaskPromiseRef.current = undefined; });
    draftTaskPromiseRef.current = promise;
    return promise;
  }, [task, workspace]);
  const updateDraft = useCallback(async (draft: string) => { const activeTask = await ensureDraftTask(); if (!activeTask) return; const next = await window.lotagate.tasks.update(activeTask.id, { draft }); draftTaskRef.current = next; setTask(next); }, [ensureDraftTask]);
  const appendDraftAttachment = useCallback(async (artifact: Artifact) => {
    const activeTask = draftTaskRef.current ?? task;
    if (!activeTask || activeTask.draftAttachmentIds.includes(artifact.id)) return;
    const next = await window.lotagate.tasks.update(activeTask.id, { draftAttachmentIds: [...activeTask.draftAttachmentIds, artifact.id] });
    draftTaskRef.current = next;
    setTask(next);
    setAttachments(await loadAttachmentPreviews(next.id, next.draftAttachmentIds));
  }, [task]);
  const pickArtifact = useCallback(async () => { const activeTask = await ensureDraftTask(); if (!activeTask) return; const artifact = await window.lotagate.tasks.pickArtifact(activeTask.id); if (artifact) await appendDraftAttachment(artifact); }, [appendDraftAttachment, ensureDraftTask]);
  const attachImage = useCallback(async (name: string, bytes: Uint8Array) => { const activeTask = await ensureDraftTask(); if (!activeTask) return; const artifact = await window.lotagate.tasks.createImageArtifact(activeTask.id, name, bytes); await appendDraftAttachment(artifact); }, [appendDraftAttachment, ensureDraftTask]);
  const removeAttachment = useCallback(async (attachmentId: string) => { const activeTask = draftTaskRef.current ?? task; if (!activeTask || !activeTask.draftAttachmentIds.includes(attachmentId)) return; await window.lotagate.tasks.deleteArtifact(activeTask.id, attachmentId, true); const next = await window.lotagate.tasks.update(activeTask.id, { draftAttachmentIds: activeTask.draftAttachmentIds.filter(id => id !== attachmentId) }); draftTaskRef.current = next; setTask(next); setAttachments(current => current.filter(item => item.id !== attachmentId)); }, [task]);
  const removeQueuedMessage = useCallback(async (id: string) => {
    const removed = messageQueueServiceRef.current.remove(id);
    if (!removed) return;
    const activeTask = draftTaskRef.current ?? task;
    const protectedIds = [...(activeTask?.draftAttachmentIds ?? []), ...messageQueueServiceRef.current.snapshot().flatMap(item => item.attachments.map(attachment => attachment.id))];
    await discardQueuedAttachments(activeTask?.id, [removed], activities, protectedIds);
  }, [activities, task]);
  const editQueuedMessage = useCallback(async (id: string): Promise<QueuedMessage | undefined> => {
    const message = messageQueueServiceRef.current.remove(id);
    if (!message) return undefined;
    const activeTask = await ensureDraftTask();
    if (!activeTask) { messageQueueServiceRef.current.prepend(message); return undefined; }
    try {
      const attachmentIds = [...new Set([...activeTask.draftAttachmentIds, ...message.attachments.map(attachment => attachment.id)])];
      const next = await window.lotagate.tasks.update(activeTask.id, { draft: message.prompt, draftAttachmentIds: attachmentIds });
      draftTaskRef.current = next;
      setTask(next);
      setTasks(current => current.map(item => item.id === next.id ? next : item));
      setAttachments(await loadAttachmentPreviews(next.id, attachmentIds));
      return message;
    } catch (reason) {
      messageQueueServiceRef.current.prepend(message);
      setError(toMessage(reason));
      return undefined;
    }
  }, [ensureDraftTask]);
  const steerQueuedMessage = useCallback(async (id: string) => {
    const queued = messageQueueServiceRef.current.snapshot().find(item => item.id === id);
    if (!queued || !task || !workspace) return;
    const activeTurn = activeTurnRef.current?.taskId === task.id && activeTurnRef.current.cwd === workspace.rootPath ? activeTurnRef.current : undefined;
    if (!activeTurn) { const removed = messageQueueServiceRef.current.remove(id); if (removed) await dispatchQueuedPrompt(removed); return; }
    steeringQueueIdRef.current = id;
    suppressQueueRef.current = false;
    try { await window.lotagate.agent.turnCancel(workspace.rootPath, activeTurn.turnId); }
    catch (reason) { steeringQueueIdRef.current = undefined; setError(toMessage(reason)); }
  }, [dispatchQueuedPrompt, task, workspace]);
  const cancelTask = useCallback(async () => {
    if (!task || !workspace) return;
    const activeTurn = activeTurnRef.current?.taskId === task.id && activeTurnRef.current.cwd === workspace.rootPath ? activeTurnRef.current : undefined;
    setError(undefined); suppressQueueRef.current = true; steeringQueueIdRef.current = undefined;
    await cancelWorkspaceTask({ task, workspace, activeTurn, clearActiveTurn: () => { activeTurnRef.current = undefined; }, resetLiveState: () => { setThinking(false); setThinkingStartedAt(undefined); setAgentStatus(undefined); }, setTask, updateTasks: update => setTasks(update), reloadTasks, setError });
  }, [reloadTasks, task, workspace]);
  const retryTask = useCallback(async () => { if (!task) return; const history = await window.lotagate.tasks.activities(task.id); const prompt = [...history].reverse().find(item => item.kind === 'user')?.text; if (prompt) await window.lotagate.tasks.retry(task.id); if (prompt) await sendPrompt(prompt); }, [sendPrompt, task]);
  const archiveTask = useCallback(async (taskId: string, archived: boolean) => { if (!workspace) return; await window.lotagate.tasks.archive(taskId, archived); await reloadTasks(workspace.id); }, [reloadTasks, workspace]);
  const pinTask = useCallback(async (pinned: boolean) => { if (!task || !workspace) return; await window.lotagate.tasks.pin(task.id, pinned); await reloadTasks(workspace.id); }, [reloadTasks, task, workspace]);
  const pinTaskById = useCallback(async (taskId: string, pinned: boolean) => {
    const updated = await window.lotagate.tasks.pin(taskId, pinned);
    setTasks(current => current.map(item => item.id === updated.id ? updated : item));
    setTask(current => current?.id === updated.id ? updated : current);
  }, []);
  return useMemo(() => ({ workspaces, workspace, tasks, task, activities, activityAttachments, activityArtifacts, activitiesLoading, hasOlderActivities, loadingOlderActivities, loadOlderActivities, fileChanges, fileChangesByTurn, plan, subagents, attachments, queuedMessages, approval, approvalMode, setApprovalMode: updateApprovalMode, trust, models, selectedModel, setSelectedModel: selectModel, loading, busy, thinking, thinkingStartedAt, agentStatus, contextCompactionStatus, turnTimings, error, selectWorkspace, selectTask, newTask, addWorkspace, trustWorkspace, renameWorkspace, renameTask, removeWorkspace, sendPrompt, runCommand, respondApproval, respondTrust, updateDraft, pickArtifact, attachImage, removeAttachment, removeQueuedMessage, editQueuedMessage, steerQueuedMessage, cancelTask, retryTask, archiveTask, pinTask, pinTaskById }), [workspaces, workspace, tasks, task, activities, activityAttachments, activityArtifacts, activitiesLoading, hasOlderActivities, loadingOlderActivities, loadOlderActivities, fileChanges, fileChangesByTurn, plan, subagents, attachments, queuedMessages, approval, approvalMode, trust, models, selectedModel, selectModel, loading, busy, thinking, thinkingStartedAt, agentStatus, contextCompactionStatus, turnTimings, error, selectWorkspace, selectTask, newTask, addWorkspace, trustWorkspace, renameWorkspace, renameTask, removeWorkspace, sendPrompt, runCommand, respondApproval, respondTrust, updateDraft, pickArtifact, attachImage, removeAttachment, editQueuedMessage, removeQueuedMessage, steerQueuedMessage, cancelTask, retryTask, archiveTask, pinTask, pinTaskById, updateApprovalMode]);
}
