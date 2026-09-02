import type { Task } from '../../../contracts/ipc/v1/workspace.js';

export function orderTasksForSidebar(tasks: readonly Task[]): Task[] {
  return [...tasks].sort((left, right) => Number(right.pinned) - Number(left.pinned) || right.updatedAt.localeCompare(left.updatedAt));
}

export function firstTaskForWorkspace(tasks: readonly Task[], workspaceId: string): Task | undefined {
  return orderTasksForSidebar(tasks.filter(task => task.workspaceId === workspaceId && !task.archived))[0];
}
