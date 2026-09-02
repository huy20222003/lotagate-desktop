import type { Task, Workspace } from '../../../../contracts/ipc/v1/workspace.js';
import { toUserErrorMessage } from '../../../utils/errors.js';

type ActiveTurn = { taskId: string; cwd: string; turnId: string };

export async function cancelWorkspaceTask({ task, workspace, activeTurn, clearActiveTurn, resetLiveState, setTask, updateTasks, reloadTasks, setError }: {
  task: Task;
  workspace: Workspace;
  activeTurn: ActiveTurn | undefined;
  clearActiveTurn: () => void;
  resetLiveState: () => void;
  setTask: (task: Task) => void;
  updateTasks: (update: (tasks: Task[]) => Task[]) => void;
  reloadTasks: (workspaceId: string) => Promise<void>;
  setError: (message: string | undefined) => void;
}): Promise<void> {
  const turnId = activeTurn?.turnId ?? task.turnId;
  try {
    if (turnId !== undefined) await window.lotagate.agent.turnCancel(workspace.rootPath, turnId);
    const cancelled = await window.lotagate.tasks.cancel(task.id);
    clearActiveTurn();
    setTask(cancelled);
    updateTasks(items => items.map(item => item.id === cancelled.id ? cancelled : item));
    resetLiveState();
    await reloadTasks(workspace.id);
  } catch (reason) {
    const refreshed = await window.lotagate.tasks.list(workspace.id).catch(() => [] as Task[]);
    const refreshedTask = refreshed.find(item => item.id === task.id);
    if (refreshedTask?.turnId === undefined && refreshedTask?.status !== 'active') {
      clearActiveTurn();
      resetLiveState();
      if (refreshedTask !== undefined) {
        updateTasks(items => items.map(item => item.id === refreshedTask.id ? refreshedTask : item));
        setTask(refreshedTask);
      }
      return;
    }
    setError(toUserErrorMessage(reason));
  }
}
