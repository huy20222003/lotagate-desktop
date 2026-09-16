import type { MutableRefObject } from 'react';
import { DESKTOP_COMMAND_TIMING_METADATA_KEY, type FileChangeSummary, type Task, type Workspace, type WorkPlanSnapshot, type SubagentSnapshot } from '../../../../contracts/ipc/v1/workspace.js';
import type { AttachmentPreview } from '../../../services/attachment-types.js';
import { sessionSlugFromPrompt } from '../conversation/task-title.js';
import { activeTurnForTask, type WorkspaceActiveTurn } from './workspace-controller-helpers.js';
import { commandStatusForAction } from './agent-status.js';
import { executeDesktopCommandResult, type DesktopCommandInvocation } from '../../../services/desktop-command-client.js';
import { toUserErrorMessage as toMessage } from '../../../utils/errors.js';
import { persistDesktopCommandResult } from './desktop-command-result-persistence.js';
import { createRendererOperationOwner, isRendererOperationCurrent, resolveRendererOperationOwner } from './operation-owner.js';

type StateSetter<T> = (value: T | ((current: T) => T)) => void;

export interface WorkspaceCommandActionDependencies {
  workspace: Workspace | undefined;
  task: Task | undefined;
  draftTaskRef: MutableRefObject<Task | undefined>;
  workspaceRef: MutableRefObject<Workspace | undefined>;
  activeTurnRef: MutableRefObject<WorkspaceActiveTurn | undefined>;
  selectionRevisionRef: MutableRefObject<number>;
  setBusy: StateSetter<boolean>;
  setError: StateSetter<string | undefined>;
  emptyFileChangeSummary: FileChangeSummary;
  setFileChanges: StateSetter<FileChangeSummary>;
  setActiveTurnId: StateSetter<string | undefined>;
  setPlan: StateSetter<WorkPlanSnapshot | undefined>;
  setSubagents: StateSetter<SubagentSnapshot[]>;
  setFinalResponseReceived: StateSetter<boolean>;
  setAgentStatus: StateSetter<string | undefined>;
  setThinking: StateSetter<boolean>;
  setThinkingStartedAt: StateSetter<number | undefined>;
  setAttachments: StateSetter<AttachmentPreview[]>;
  setTask: StateSetter<Task | undefined>;
  createTask: (prompt: string, isCurrent: () => boolean) => Promise<Task>;
  loadActivities: (taskId: string, reset?: boolean, restorePlan?: boolean) => Promise<void>;
  reloadTasks: (workspaceId: string) => Promise<void>;
}

export async function runWorkspaceCommand(deps: WorkspaceCommandActionDependencies, invocation: DesktopCommandInvocation, preview: string): Promise<boolean> {
  const { workspace, task } = deps;
  if (!workspace || !preview.trim()) return false;
  if (activeTurnForTask(task?.id, workspace.rootPath, deps.activeTurnRef.current) !== undefined) {
    deps.setError('Wait for the active response to finish before running a slash command.');
    return false;
  }
  const owner = createRendererOperationOwner(workspace, task, deps.selectionRevisionRef.current);
  const isCurrent = (): boolean => isRendererOperationCurrent(owner, deps.workspaceRef.current, deps.draftTaskRef.current, deps.selectionRevisionRef.current);
  deps.setBusy(true); deps.setError(undefined); deps.setFileChanges(deps.emptyFileChangeSummary); deps.setActiveTurnId(undefined); deps.activeTurnRef.current = undefined; deps.setPlan(undefined); deps.setSubagents([]); deps.setFinalResponseReceived(false); deps.setAgentStatus(commandStatusForAction(invocation.actionId) ?? 'Running command…'); deps.setThinking(true); deps.setThinkingStartedAt(Date.now());
  const commandStartedAt = Date.now();
  try {
    const existingTask = task ?? deps.draftTaskRef.current;
    const isNewTask = existingTask === undefined;
    let activeTask = existingTask ?? await deps.createTask(preview, isCurrent);
    resolveRendererOperationOwner(owner, activeTask.id);
    if (isCurrent()) deps.draftTaskRef.current = activeTask;
    if (!isNewTask) await window.lotagate.tasks.addActivity(activeTask.id, 'user', preview, { command: invocation.actionId });
    activeTask = await window.lotagate.tasks.update(activeTask.id, { draft: '', draftAttachmentIds: [], ...(activeTask.titleSource === 'automatic' && activeTask.title === 'New chat' ? { title: sessionSlugFromPrompt(preview) } : {}) });
    if (isCurrent()) { deps.draftTaskRef.current = activeTask; deps.setTask(activeTask); deps.setAttachments([]); }
    await deps.loadActivities(activeTask.id, isNewTask, false);
    await window.lotagate.tasks.setStatus(activeTask.id, 'active');
    await window.lotagate.agent.initialize(activeTask.cwd);
    const result = await executeDesktopCommandResult(activeTask.cwd, invocation);
    const commandEndedAt = Date.now();
    const mediaImportFailures = await persistDesktopCommandResult(activeTask.id, invocation.actionId, result, commandStartedAt, commandEndedAt);
    if (mediaImportFailures > 0 && isCurrent()) deps.setError(`Command completed, but ${mediaImportFailures} media file${mediaImportFailures === 1 ? '' : 's'} could not be imported.`);
    await window.lotagate.tasks.setStatus(activeTask.id, 'completed');
    if (!isCurrent()) return true;
    await deps.reloadTasks(owner.workspaceId);
    if (isCurrent()) await deps.loadActivities(activeTask.id, isNewTask);
    return true;
  } catch (reason) {
    const failedTaskId = owner.taskResolved ? owner.taskId : undefined;
    if (failedTaskId) {
      const commandEndedAt = Date.now();
      await window.lotagate.tasks.addActivity(failedTaskId, 'error', toMessage(reason), { command: invocation.actionId, [DESKTOP_COMMAND_TIMING_METADATA_KEY]: { startedAt: commandStartedAt, endedAt: commandEndedAt } }).catch(() => undefined);
      await window.lotagate.tasks.setStatus(failedTaskId, 'failed').catch(() => undefined);
    }
    if (isCurrent()) { deps.setPlan(undefined); deps.setSubagents([]); deps.setError(toMessage(reason)); }
    return false;
  } finally {
    if (isCurrent()) { deps.setBusy(false); deps.setThinking(false); deps.setThinkingStartedAt(undefined); deps.setAgentStatus(undefined); }
  }
}
