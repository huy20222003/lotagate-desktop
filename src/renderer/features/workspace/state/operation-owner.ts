import type { Task, Workspace } from '../../../../contracts/ipc/v1/workspace.js';

export interface RendererOperationOwner {
  workspaceId: string;
  taskId?: string;
  taskResolved: boolean;
  selectionRevision: number;
}

export function createRendererOperationOwner(workspace: Workspace, task: Task | undefined, selectionRevision: number): RendererOperationOwner {
  return { workspaceId: workspace.id, ...(task === undefined ? {} : { taskId: task.id }), taskResolved: task !== undefined, selectionRevision };
}

export function resolveRendererOperationOwner(owner: RendererOperationOwner, taskId: string): void {
  owner.taskId = taskId;
  owner.taskResolved = true;
}

export function isRendererOperationCurrent(owner: RendererOperationOwner, workspace: Workspace | undefined, task: Task | undefined, selectionRevision: number): boolean {
  if (workspace?.id !== owner.workspaceId) return false;
  if (selectionRevision !== owner.selectionRevision) return false;
  return owner.taskResolved ? task?.id === owner.taskId : task === undefined;
}
