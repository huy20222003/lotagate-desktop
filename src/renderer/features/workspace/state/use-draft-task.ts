import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import type { Task, Workspace } from '../../../../contracts/ipc/v1/workspace.js';
import { sessionSlugFromPrompt } from '../conversation/task-title.js';

interface UseDraftTaskOptions {
  readonly workspace: Workspace | undefined;
  readonly task: Task | undefined;
  readonly draftTaskRef: MutableRefObject<Task | undefined>;
  readonly draftTaskPromiseRef: MutableRefObject<Promise<Task | undefined> | undefined>;
  readonly setTasks: Dispatch<SetStateAction<Task[]>>;
  readonly setTask: Dispatch<SetStateAction<Task | undefined>>;
}

export function useDraftTask({ workspace, task, draftTaskRef, draftTaskPromiseRef, setTasks, setTask }: UseDraftTaskOptions) {
  const createTask = useCallback(async (prompt: string, shouldCommitSelection?: () => boolean) => {
    if (workspace === undefined) throw new Error('Select a workspace first.');
    const created = await window.lotagate.tasks.create({ workspaceId: workspace.id, title: sessionSlugFromPrompt(prompt), titleSource: 'automatic', prompt });
    setTasks(current => [created, ...current]);
    if (shouldCommitSelection?.() !== false) {
      draftTaskRef.current = created;
      setTask(created);
    }
    return created;
  }, [draftTaskRef, setTask, setTasks, workspace]);

  const ensureDraftTask = useCallback(async (): Promise<Task | undefined> => {
    if (task !== undefined) { draftTaskRef.current = task; return task; }
    if (draftTaskRef.current !== undefined) return draftTaskRef.current;
    if (workspace === undefined) return undefined;
    if (draftTaskPromiseRef.current !== undefined) return draftTaskPromiseRef.current;
    const promise = window.lotagate.tasks.create({ workspaceId: workspace.id, title: 'New chat', titleSource: 'automatic' }).then(created => {
      draftTaskRef.current = created;
      setTasks(current => current.some(item => item.id === created.id) ? current : [created, ...current]);
      setTask(created);
      return created;
    }).finally(() => { draftTaskPromiseRef.current = undefined; });
    draftTaskPromiseRef.current = promise;
    return promise;
  }, [draftTaskPromiseRef, draftTaskRef, setTask, setTasks, task, workspace]);

  return { createTask, ensureDraftTask };
}
