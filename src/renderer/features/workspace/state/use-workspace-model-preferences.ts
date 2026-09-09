import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import type { Task } from '../../../../contracts/ipc/v1/workspace.js';
import type { DesktopReasoningEffort } from '../../../../contracts/agent-protocol/v1/desktop.js';
import { writeSelectedEffort, writeSelectedModel } from '../../../services/model-preference.js';

interface WorkspaceModelPreferencesOptions {
  readonly task: Task | undefined;
  readonly draftTaskRef: MutableRefObject<Task | undefined>;
  readonly setSelectedModelValue: (model: string) => void;
  readonly setSelectedEffortValue: (effort: DesktopReasoningEffort) => void;
  readonly setTask: Dispatch<SetStateAction<Task | undefined>>;
  readonly setTasks: Dispatch<SetStateAction<Task[]>>;
}

export function useWorkspaceModelPreferences({ task, draftTaskRef, setSelectedModelValue, setSelectedEffortValue, setTask, setTasks }: WorkspaceModelPreferencesOptions) {
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
  }, [draftTaskRef, setSelectedModelValue, setTask, setTasks, task]);

  const selectEffort = useCallback((effort: DesktopReasoningEffort) => {
    setSelectedEffortValue(effort);
    writeSelectedEffort(effort);
  }, [setSelectedEffortValue]);

  return { selectModel, selectEffort };
}
