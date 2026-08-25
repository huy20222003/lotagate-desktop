import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Activity, ApprovalRequest, Artifact, Task, TrustRequest, Workspace } from '../../../contracts/ipc/v1/workspace.js';
import { sessionSlugFromPrompt } from './task-title.js';
import { shouldAutoApprove, type ApprovalMode } from './approval-policy.js';

export function useWorkspaceController() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspace, setWorkspace] = useState<Workspace | undefined>();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [task, setTask] = useState<Task | undefined>();
  const [activities, setActivities] = useState<Activity[]>([]);
  const [activitiesLoading, setActivitiesLoading] = useState(false);
  const [attachments, setAttachments] = useState<AttachmentPreview[]>([]);
  const [approval, setApproval] = useState<ApprovalRequest | undefined>();
  const [approvalMode, setApprovalMode] = useState<ApprovalMode>('auto');
  const [trust, setTrust] = useState<TrustRequest | undefined>();
  const [models, setModels] = useState<Array<{ id: string; label: string }>>([]);
  const [selectedModel, setSelectedModel] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [agentStatus, setAgentStatus] = useState<string | undefined>();
  const [turnTimings, setTurnTimings] = useState<Record<string, { startedAt: number; endedAt?: number }>>({});
  const [error, setError] = useState<string | undefined>();
  const draftTaskRef = useRef<Task | undefined>();
  const draftTaskPromiseRef = useRef<Promise<Task | undefined>>();
  useEffect(() => { draftTaskRef.current = task; }, [task]);

  const reloadTasks = useCallback(async (workspaceId: string) => {
    const next = (await Promise.all(workspaces.map(item => window.lotagate.tasks.list(item.id)))).flat();
    setTasks(next);
    setTask(current => current === undefined
      ? next.find(item => item.workspaceId === workspaceId && !item.archived)
      : next.find(item => item.id === current.id && !item.archived) ?? next.find(item => item.workspaceId === workspaceId && !item.archived));
  }, [workspaces]);

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

  useEffect(() => { if (workspace) void reloadTasks(workspace.id); }, [workspace, reloadTasks]);
  useEffect(() => {
    if (!workspace) return;
    void window.lotagate.agent.initialize(workspace.rootPath).then(async () => {
      const modelValue = await window.lotagate.agent.modelList(workspace.rootPath);
      const next = extractModels(modelValue);
      setModels(next);
      setSelectedModel(current => current || next[0]?.id || '');
    }).catch(() => undefined);
  }, [workspace]);
  useEffect(() => {
    let mounted = true;
    if (!task) { setActivities([]); setAttachments([]); setActivitiesLoading(false); return; }
    setActivitiesLoading(true);
    void window.lotagate.tasks.activities(task.id).then(next => { if (mounted) setActivities(next); }).catch(reason => { if (mounted) setError(toMessage(reason)); }).finally(() => { if (mounted) setActivitiesLoading(false); });
    void loadAttachmentPreviews(task.id, task.draftAttachmentIds).then(next => { if (mounted) setAttachments(next); }).catch(() => { if (mounted) setAttachments([]); });
    return () => { mounted = false; };
  }, [task?.id]);

  useEffect(() => window.lotagate.agent.onEvent(envelope => {
    if (workspace === undefined || envelope.cwd !== workspace.rootPath) return;
    const data = envelope.event.data;
    const terminal = envelope.event.event === 'turn.completed' || envelope.event.event === 'turn.failed' || envelope.event.event === 'turn.cancelled';
    const eventSessionId = typeof data['sessionId'] === 'string' ? data['sessionId'] : undefined;
    const eventTask = tasks.find(item => eventSessionId !== undefined && item.sessionId === eventSessionId) ?? (tasks.length === 1 ? tasks[0] : undefined);
    if (eventTask?.id === task?.id) {
      const turnId = typeof data['turnId'] === 'string' ? data['turnId'] : undefined;
      if (turnId && envelope.event.event === 'turn.started') setTurnTimings(current => ({ ...current, [turnId]: { startedAt: Date.now() } }));
      if (turnId && terminal) setTurnTimings(current => ({ ...current, [turnId]: { startedAt: current[turnId]?.startedAt ?? Date.now(), endedAt: Date.now() } }));
      const status = eventStatus(envelope.event.event, data);
      if (status !== undefined) setAgentStatus(status);
      else if (terminal || envelope.event.event === 'tool.completed') setAgentStatus(undefined);
      if (envelope.event.event === 'turn.started') setThinking(true);
      if (terminal) { setThinking(false); setAgentStatus(undefined); }
    }
    if (eventTask !== undefined && eventTask.id === task?.id) {
      if (envelope.event.event === 'approval.requested') {
        const request: ApprovalRequest = { approvalId: String(data['approvalId']), taskId: eventTask.id, turnId: String(data['turnId']), toolName: String(data['toolName'] ?? 'tool'), displayName: String(data['displayName'] ?? data['toolName'] ?? 'Tool'), kind: String(data['kind'] ?? 'action'), detail: (data['detail'] as Record<string, unknown> | undefined) ?? {} };
        if (shouldAutoApprove(request, approvalMode)) void window.lotagate.agent.approvalRespond(workspace.rootPath, { approvalId: request.approvalId, approved: true }).catch(reason => setError(toMessage(reason)));
        else setApproval(request);
      }
      if (envelope.event.event === 'trust.requested') setTrust({ trustRequestId: String(data['trustRequestId']), taskId: eventTask.id, sessionId: String(data['sessionId']), path: String(data['path']) });
    }
    if (task) void window.lotagate.tasks.activities(task.id).then(setActivities);
    void reloadTasks(workspace.id);
  }), [approvalMode, workspace, task, tasks, reloadTasks]);

  const selectWorkspace = useCallback((next: Workspace) => {
    setWorkspace(next);
    setTask(current => current?.workspaceId === next.id ? current : tasks.find(item => item.workspaceId === next.id && !item.archived));
    setApproval(undefined); setTrust(undefined); setAgentStatus(undefined);
  }, [tasks]);
  const selectTask = useCallback((next: Task) => {
    setWorkspace(current => workspaces.find(item => item.id === next.workspaceId) ?? current);
    setTask(next);
    setApproval(undefined);
    setTrust(undefined); setAgentStatus(undefined);
    if (next.sessionId) void window.lotagate.agent.sessionResume(next.cwd, next.sessionId).catch(reason => setError(toMessage(reason)));
  }, [workspaces]);
  const newTask = useCallback(async (targetWorkspace?: Workspace) => {
    const target = targetWorkspace ?? workspace;
    if (target === undefined) return;
    setBusy(true); setError(undefined); setThinking(false); setAgentStatus(undefined); setWorkspace(target); setApproval(undefined); setTrust(undefined);
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
  }, [workspace]);

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
  const removeWorkspace = useCallback(async (workspaceId: string) => {
    await window.lotagate.workspaces.remove(workspaceId);
    setWorkspaces(current => current.filter(item => item.id !== workspaceId));
    setTasks(current => current.filter(item => item.workspaceId !== workspaceId));
    setWorkspace(current => current?.id === workspaceId ? undefined : current);
    setTask(current => current?.workspaceId === workspaceId ? undefined : current);
    setActivities([]); setApproval(undefined); setTrust(undefined); setAgentStatus(undefined); setThinking(false);
  }, []);
  const createTask = useCallback(async (prompt: string) => {
    if (workspace === undefined) throw new Error('Select a workspace first.');
    const title = sessionSlugFromPrompt(prompt);
    const created = await window.lotagate.tasks.create({ workspaceId: workspace.id, title, prompt });
    setTasks(current => [created, ...current]); setTask(created); return created;
  }, [workspace]);

  const sendPrompt = useCallback(async (prompt: string) => {
    if (!prompt.trim() || workspace === undefined) return;
    setBusy(true); setError(undefined);
    let failedTaskId: string | undefined;
    try {
      const isNewTask = task === undefined;
      let activeTask = task ?? await createTask(prompt);
      failedTaskId = activeTask.id;
      if (!isNewTask) await window.lotagate.tasks.addActivity(activeTask.id, 'user', prompt);
      const attachmentIds = activeTask.draftAttachmentIds;
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
      await window.lotagate.tasks.update(activeTask.id, { sessionId });
      const model = selectedModel || activeTask.model;
      if (model && activeTask.model !== model) await window.lotagate.tasks.update(activeTask.id, { model });
      setThinking(true); setAgentStatus(undefined);
      const turn = await window.lotagate.agent.turnStart(activeTask.cwd, { sessionId, prompt, taskId: activeTask.id, ...(model ? { model } : {}), ...(attachmentIds.length === 0 ? {} : { attachmentIds }) });
      const turnId = extractTurnId(turn);
      if (turnId) { setTurnTimings(current => ({ ...current, [turnId]: { startedAt: current[turnId]?.startedAt ?? Date.now() } })); setTask(await window.lotagate.tasks.update(activeTask.id, { turnId })); }
      if (!handshake) throw new Error('CLI handshake failed.');
      await reloadTasks(workspace.id);
    } catch (reason) { setThinking(false); setAgentStatus(undefined); setError(toMessage(reason)); if (failedTaskId) await window.lotagate.tasks.setStatus(failedTaskId, 'failed'); }
    finally { setBusy(false); }
  }, [createTask, reloadTasks, selectedModel, task, workspace]);

  const respondApproval = useCallback(async (approved: boolean) => { if (!approval || workspace === undefined) return; await window.lotagate.agent.approvalRespond(workspace.rootPath, { approvalId: approval.approvalId, approved }); setApproval(undefined); }, [approval, workspace]);
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
  const cancelTask = useCallback(async () => { if (!task || !workspace) return; if (task.turnId) await window.lotagate.agent.turnCancel(workspace.rootPath, task.turnId).catch(() => undefined); setThinking(false); setAgentStatus(undefined); await window.lotagate.tasks.cancel(task.id); await reloadTasks(workspace.id); }, [reloadTasks, task, workspace]);
  const retryTask = useCallback(async () => { if (!task) return; const history = await window.lotagate.tasks.activities(task.id); const prompt = [...history].reverse().find(item => item.kind === 'user')?.text; if (prompt) await window.lotagate.tasks.retry(task.id); if (prompt) await sendPrompt(prompt); }, [sendPrompt, task]);
  const archiveTask = useCallback(async (taskId: string, archived: boolean) => { if (!workspace) return; await window.lotagate.tasks.archive(taskId, archived); await reloadTasks(workspace.id); }, [reloadTasks, workspace]);
  const pinTask = useCallback(async (pinned: boolean) => { if (!task || !workspace) return; await window.lotagate.tasks.pin(task.id, pinned); await reloadTasks(workspace.id); }, [reloadTasks, task, workspace]);
  const pinTaskById = useCallback(async (taskId: string, pinned: boolean) => {
    const updated = await window.lotagate.tasks.pin(taskId, pinned);
    setTasks(current => current.map(item => item.id === updated.id ? updated : item));
    setTask(current => current?.id === updated.id ? updated : current);
  }, []);

  return useMemo(() => ({ workspaces, workspace, tasks, task, activities, activitiesLoading, attachments, approval, approvalMode, setApprovalMode, trust, models, selectedModel, setSelectedModel, loading, busy, thinking, agentStatus, turnTimings, error, selectWorkspace, selectTask, newTask, addWorkspace, trustWorkspace, renameWorkspace, removeWorkspace, sendPrompt, respondApproval, respondTrust, updateDraft, pickArtifact, attachImage, removeAttachment, cancelTask, retryTask, archiveTask, pinTask, pinTaskById }), [workspaces, workspace, tasks, task, activities, activitiesLoading, attachments, approval, approvalMode, trust, models, selectedModel, loading, busy, thinking, agentStatus, turnTimings, error, selectWorkspace, selectTask, newTask, addWorkspace, trustWorkspace, renameWorkspace, removeWorkspace, sendPrompt, respondApproval, respondTrust, updateDraft, pickArtifact, attachImage, removeAttachment, cancelTask, retryTask, archiveTask, pinTask, pinTaskById]);
}

export interface AttachmentPreview {
  id: string;
  name: string;
  kind: Artifact['kind'];
  size: number;
  dataUrl?: string;
}

async function loadAttachmentPreviews(taskId: string, attachmentIds: readonly string[] = []): Promise<AttachmentPreview[]> {
  const artifacts = (await window.lotagate.tasks.artifacts(taskId)).filter(artifact => attachmentIds.includes(artifact.id));
  return Promise.all(artifacts.map(async artifact => {
    const preview: Record<string, unknown> = await window.lotagate.tasks.previewArtifact(taskId, artifact.id).catch(() => ({} as Record<string, unknown>));
    const dataUrl = typeof preview['dataUrl'] === 'string' ? preview['dataUrl'] : undefined;
    return { id: artifact.id, name: artifact.name, kind: artifact.kind, size: artifact.size, ...(dataUrl ? { dataUrl } : {}) };
  }));
}

function extractSessionId(value: unknown): string | undefined { if (typeof value !== 'object' || value === null) return undefined; const session = (value as Record<string, unknown>)['session']; if (typeof session !== 'object' || session === null) return undefined; const id = (session as Record<string, unknown>)['id']; return typeof id === 'string' ? id : undefined; }
function extractTurnId(value: unknown): string | undefined { if (typeof value !== 'object' || value === null) return undefined; const id = (value as Record<string, unknown>)['turnId']; return typeof id === 'string' ? id : undefined; }
function extractModels(value: unknown): Array<{ id: string; label: string }> { if (typeof value !== 'object' || value === null) return []; const list = (value as Record<string, unknown>)['models']; if (!Array.isArray(list)) return []; return list.flatMap(item => { if (typeof item === 'string') return [{ id: item, label: item }]; if (typeof item !== 'object' || item === null) return []; const record = item as Record<string, unknown>; const id = typeof record['id'] === 'string' ? record['id'] : typeof record['model'] === 'string' ? record['model'] : undefined; return id === undefined ? [] : [{ id, label: typeof record['label'] === 'string' ? record['label'] : id }]; }); }
function eventStatus(event: string, data: Record<string, unknown>): string | undefined {
  if (event !== 'turn.started' && event !== 'tool.started' && event !== 'command.activity.started' && event !== 'approval.requested') return undefined;
  for (const key of ['displayName', 'label', 'message', 'status']) {
    const value = data[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}
function toMessage(reason: unknown): string { return reason instanceof Error ? reason.message : 'The workspace operation failed.'; }
