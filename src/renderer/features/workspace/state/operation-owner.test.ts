import { describe, expect, it } from 'vitest';
import type { Task, Workspace } from '../../../../contracts/ipc/v1/workspace.js';
import { createRendererOperationOwner, isRendererOperationCurrent } from './operation-owner.js';

const workspace = { id: 'workspace-1' } as Workspace;
const task = { id: 'task-1' } as Task;

describe('renderer operation ownership', () => {
  it('rejects a callback from an earlier selection revision even when the task ref matches', () => {
    const owner = createRendererOperationOwner(workspace, task, 3);
    expect(isRendererOperationCurrent(owner, workspace, task, 3)).toBe(true);
    expect(isRendererOperationCurrent(owner, workspace, task, 4)).toBe(false);
  });
});
