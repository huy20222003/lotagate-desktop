import { useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import type { Task } from '../../../../contracts/ipc/v1/workspace.js';

export function useTaskUpdates(
  draftTaskRef: MutableRefObject<Task | undefined>,
  setTasks: Dispatch<SetStateAction<Task[]>>,
  setTask: Dispatch<SetStateAction<Task | undefined>>,
): void {
  useEffect(() => window.lotagate.tasks.onUpdated(updated => {
    setTasks(current => current.map(item => item.id === updated.id ? updated : item));
    if (draftTaskRef.current?.id === updated.id) {
      draftTaskRef.current = updated;
      setTask(current => current?.id === updated.id ? updated : current);
    }
  }), [draftTaskRef, setTask, setTasks]);
}
