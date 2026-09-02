import type { Task } from '../../../../contracts/ipc/v1/workspace.js';

export interface SelectedTaskLiveState {
  thinking: boolean;
  turnId?: string;
}

/** Restores only the live turn state that belongs to the selected task. */
export function selectedTaskLiveState(task: Pick<Task, 'status' | 'turnId'> | undefined): SelectedTaskLiveState {
  const turnId = task?.status === 'active' ? task.turnId : undefined;
  return { thinking: turnId !== undefined, ...(turnId === undefined ? {} : { turnId }) };
}
