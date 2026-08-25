import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Activity, ApprovalRequest, Task, TrustRequest, Workspace } from '../../../contracts/ipc/v1/workspace.js';

export interface DesktopCommandDescriptor { id: string; summary: string; requiresArguments: boolean; arguments: Array<{ name: string; required: boolean; description?: string }>; options: Array<{ name: string; required: boolean; description?: string; allowedValues?: string[] }> }

export function useWorkspaceController() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspace, setWorkspace] = useState<Workspace | undefined>();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [task, setTask] = useState<Task | undefined>();
  const [activities, setActivities] = useState<Activity[]>([]);
  const [approval, setApproval] = useState<ApprovalRequest | undefined>();
  const [trust, setTrust] = useState<TrustRequest | undefined>();
  const [models, setModels] = useState<Array<{ id: string; label: string }>>([]);
  const [commands, setCommands] = useState<DesktopCommandDescriptor[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const reloadTasks = useCallback(async (workspaceId: string) => {
    const next = await window.lotagate.tasks.list(workspaceId);
    setTasks(next);
    setTask(current => current === undefined ? next.find(item => !item.archived) : next.find(item => item.id === current.id) ?? next[0]);
  }, []);

  useEffect(() => {
    let mounted = true;
    window.lotagate.workspaces.list().then(next => { if (mounted) { setWorkspaces(next); setWorkspace(next[0]); } }).catch(reason => mounted && setError(toMessage(reason))).finally(() => mounted && setLoading(false));
    return () => { mounted = false; };
  }, []);

  useEffect(() => { if (workspace) void reloadTasks(workspace.id); }, [workspace, reloadTasks]);
  useEffect(() => {
    if (!workspace) return;
    void window.lotagate.agent.initialize(workspace.rootPath).then(async () => {
      const [modelValue, commandValue] = await Promise.all([window.lotagate.agent.modelList(workspace.rootPath), window.lotagate.agent.commandList(workspace.rootPath)]);
      const next = extractModels(modelValue);
      setModels(next);
      setSelectedModel(current => current || next[0]?.id || '');
      setCommands(extractCommands(commandValue));
    }).catch(() => undefined);
  }, [workspace]);
  useEffect(() => { if (task) window.lotagate.tasks.activities(task.id).then(setActivities).catch(reason => setError(toMessage(reason))); else setActivities([]); }, [task]);

  useEffect(() => window.lotagate.agent.onEvent(envelope => {
    if (workspace === undefined || envelope.cwd !== workspace.rootPath) return;
    const data = envelope.event.data;
    const eventSessionId = typeof data['sessionId'] === 'string' ? data['sessionId'] : undefined;
    const eventTask = tasks.find(item => eventSessionId !== undefined && item.sessionId === eventSessionId) ?? (tasks.length === 1 ? tasks[0] : undefined);
    if (eventTask !== undefined && eventTask.id === task?.id) {
      if (envelope.event.event === 'approval.requested') setApproval({ approvalId: String(data['approvalId']), taskId: eventTask.id, turnId: String(data['turnId']), toolName: String(data['toolName'] ?? 'tool'), displayName: String(data['displayName'] ?? data['toolName'] ?? 'Tool'), kind: String(data['kind'] ?? 'action'), detail: (data['detail'] as Record<string, unknown> | undefined) ?? {} });
      if (envelope.event.event === 'trust.requested') setTrust({ trustRequestId: String(data['trustRequestId']), taskId: eventTask.id, sessionId: String(data['sessionId']), path: String(data['path']) });
    }
    if (task) void window.lotagate.tasks.activities(task.id).then(setActivities);
    void reloadTasks(workspace.id);
  }), [workspace, task, tasks, reloadTasks]);

  const selectWorkspace = useCallback((next: Workspace) => { setWorkspace(next); setTask(undefined); setApproval(undefined); setTrust(undefined); }, []);
  const selectTask = useCallback((next: Task) => { setTask(next); setApproval(undefined); setTrust(undefined); }, []);
  const newTask = useCallback(() => { setTask(undefined); setApproval(undefined); setTrust(undefined); }, []);

  const addWorkspace = useCallback(async (rootPath: string) => { const next = await window.lotagate.workspaces.add(rootPath); setWorkspaces(current => [...current.filter(item => item.id !== next.id), next]); setWorkspace(next); }, []);
  const createTask = useCallback(async (prompt: string) => {
    if (workspace === undefined) throw new Error('Select a workspace first.');
    const title = prompt.trim().split(/\r?\n/u)[0]?.slice(0, 80) || 'New task';
    const created = await window.lotagate.tasks.create({ workspaceId: workspace.id, title, prompt });
    setTasks(current => [created, ...current]); setTask(created); return created;
  }, [workspace]);

  const sendPrompt = useCallback(async (prompt: string) => {
    if (!prompt.trim() || workspace === undefined) return;
    setBusy(true); setError(undefined);
    try {
      const isNewTask = task === undefined;
      const activeTask = task ?? await createTask(prompt);
      if (!isNewTask) await window.lotagate.tasks.addActivity(activeTask.id, 'user', prompt);
      const handshake = await window.lotagate.agent.initialize(activeTask.cwd);
      const session = activeTask.sessionId ? await window.lotagate.agent.sessionResume(activeTask.cwd, activeTask.sessionId) : await window.lotagate.agent.sessionCreate(activeTask.cwd, { name: activeTask.title });
      const sessionId = activeTask.sessionId ?? extractSessionId(session);
      if (sessionId === undefined) throw new Error('CLI did not return a session id.');
      await window.lotagate.tasks.update(activeTask.id, { sessionId });
      const model = selectedModel || activeTask.model;
      if (model && activeTask.model !== model) await window.lotagate.tasks.update(activeTask.id, { model });
      const turn = await window.lotagate.agent.turnStart(activeTask.cwd, { sessionId, prompt, ...(model ? { model } : {}) });
      const turnId = extractTurnId(turn);
      if (turnId) await window.lotagate.tasks.update(activeTask.id, { turnId });
      if (!handshake) throw new Error('CLI handshake failed.');
      await reloadTasks(workspace.id);
    } catch (reason) { setError(toMessage(reason)); if (task) await window.lotagate.tasks.setStatus(task.id, 'failed'); }
    finally { setBusy(false); }
  }, [createTask, reloadTasks, selectedModel, task, workspace]);

  const respondApproval = useCallback(async (approved: boolean) => { if (!approval || workspace === undefined) return; await window.lotagate.agent.approvalRespond(workspace.rootPath, { approvalId: approval.approvalId, approved }); setApproval(undefined); }, [approval, workspace]);
  const respondTrust = useCallback(async (trusted: boolean) => { if (!trust || workspace === undefined) return; await window.lotagate.agent.trustRespond(workspace.rootPath, { trustRequestId: trust.trustRequestId, trusted }); if (trusted) { const updated = await window.lotagate.workspaces.trust(workspace.id, true); setWorkspace(updated); setWorkspaces(current => current.map(item => item.id === updated.id ? updated : item)); } setTrust(undefined); }, [trust, workspace]);
  const updateDraft = useCallback(async (draft: string) => { if (task) { const next = await window.lotagate.tasks.update(task.id, { draft }); setTask(next); } }, [task]);
  const pickArtifact = useCallback(async () => { if (!task) return; const artifact = await window.lotagate.tasks.pickArtifact(task.id); if (artifact) { await window.lotagate.tasks.addActivity(task.id, 'file', `Attached ${artifact.name}.`, { artifactId: artifact.id, kind: artifact.kind, size: artifact.size }); setActivities(await window.lotagate.tasks.activities(task.id)); } }, [task]);
  const runCommand = useCallback(async (commandId: string, positionals: string[] = [], options: Record<string, string | boolean> = {}) => {
    if (!workspace || !task) return;
    const result = await window.lotagate.agent.commandExecute(workspace.rootPath, { actionId: commandId, positionals, options });
    await window.lotagate.tasks.addActivity(task.id, 'command', `Command ${commandId} started.`, { commandId, result });
    setActivities(await window.lotagate.tasks.activities(task.id));
  }, [task, workspace]);
  const cancelTask = useCallback(async () => { if (!task || !workspace) return; if (task.turnId) await window.lotagate.agent.turnCancel(workspace.rootPath, task.turnId).catch(() => undefined); await window.lotagate.tasks.cancel(task.id); await reloadTasks(workspace.id); }, [reloadTasks, task, workspace]);
  const retryTask = useCallback(async () => { if (!task) return; const history = await window.lotagate.tasks.activities(task.id); const prompt = [...history].reverse().find(item => item.kind === 'user')?.text; if (prompt) await window.lotagate.tasks.retry(task.id); if (prompt) await sendPrompt(prompt); }, [sendPrompt, task]);
  const archiveTask = useCallback(async (archived: boolean) => { if (!task || !workspace) return; await window.lotagate.tasks.archive(task.id, archived); await reloadTasks(workspace.id); }, [reloadTasks, task, workspace]);
  const pinTask = useCallback(async (pinned: boolean) => { if (!task || !workspace) return; await window.lotagate.tasks.pin(task.id, pinned); await reloadTasks(workspace.id); }, [reloadTasks, task, workspace]);

  return useMemo(() => ({ workspaces, workspace, tasks, task, activities, approval, trust, models, commands, selectedModel, setSelectedModel, loading, busy, error, selectWorkspace, selectTask, newTask, addWorkspace, sendPrompt, respondApproval, respondTrust, updateDraft, pickArtifact, runCommand, cancelTask, retryTask, archiveTask, pinTask }), [workspaces, workspace, tasks, task, activities, approval, trust, models, commands, selectedModel, loading, busy, error, selectWorkspace, selectTask, newTask, addWorkspace, sendPrompt, respondApproval, respondTrust, updateDraft, pickArtifact, runCommand, cancelTask, retryTask, archiveTask, pinTask]);
}

function extractSessionId(value: unknown): string | undefined { if (typeof value !== 'object' || value === null) return undefined; const session = (value as Record<string, unknown>)['session']; if (typeof session !== 'object' || session === null) return undefined; const id = (session as Record<string, unknown>)['id']; return typeof id === 'string' ? id : undefined; }
function extractTurnId(value: unknown): string | undefined { if (typeof value !== 'object' || value === null) return undefined; const id = (value as Record<string, unknown>)['turnId']; return typeof id === 'string' ? id : undefined; }
function extractModels(value: unknown): Array<{ id: string; label: string }> { if (typeof value !== 'object' || value === null) return []; const list = (value as Record<string, unknown>)['models']; if (!Array.isArray(list)) return []; return list.flatMap(item => { if (typeof item === 'string') return [{ id: item, label: item }]; if (typeof item !== 'object' || item === null) return []; const record = item as Record<string, unknown>; const id = typeof record['id'] === 'string' ? record['id'] : typeof record['model'] === 'string' ? record['model'] : undefined; return id === undefined ? [] : [{ id, label: typeof record['label'] === 'string' ? record['label'] : id }]; }); }
function extractCommands(value: unknown): DesktopCommandDescriptor[] { if (typeof value !== 'object' || value === null) return []; const list = (value as Record<string, unknown>)['commands']; if (!Array.isArray(list)) return []; return list.flatMap(item => { if (typeof item !== 'object' || item === null) return []; const record = item as Record<string, unknown>; const id = typeof record['id'] === 'string' ? record['id'] : undefined; if (!id) return []; const argumentsList = Array.isArray(record['arguments']) ? record['arguments'] : []; const argumentsValue = argumentsList.flatMap(argument => { if (typeof argument !== 'object' || argument === null) return []; const itemRecord = argument as Record<string, unknown>; const name = typeof itemRecord['name'] === 'string' ? itemRecord['name'] : undefined; return name ? [{ name, required: itemRecord['required'] === true, ...(typeof itemRecord['description'] === 'string' ? { description: itemRecord['description'] } : {}) }] : []; }); const optionsList = Array.isArray(record['options']) ? record['options'] : []; const optionsValue = optionsList.flatMap(option => { if (typeof option !== 'object' || option === null) return []; const optionRecord = option as Record<string, unknown>; const name = typeof optionRecord['name'] === 'string' ? optionRecord['name'] : undefined; const allowedValues = Array.isArray(optionRecord['allowedValues']) ? optionRecord['allowedValues'].filter((value): value is string => typeof value === 'string') : undefined; return name ? [{ name, required: optionRecord['required'] === true, ...(typeof optionRecord['description'] === 'string' ? { description: optionRecord['description'] } : {}), ...(allowedValues === undefined ? {} : { allowedValues }) }] : []; }); return [{ id, summary: typeof record['summary'] === 'string' ? record['summary'] : id, requiresArguments: argumentsValue.some(argument => argument.required) || optionsValue.some(option => option.required), arguments: argumentsValue, options: optionsValue }]; }); }
function toMessage(reason: unknown): string { return reason instanceof Error ? reason.message : 'The workspace operation failed.'; }
