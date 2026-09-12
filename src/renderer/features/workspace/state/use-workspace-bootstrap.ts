import { useEffect, type Dispatch, type SetStateAction } from 'react';
import type { Task, Workspace } from '../../../../contracts/ipc/v1/workspace.js';
import { toUserErrorMessage } from '../../../utils/errors.js';

interface WorkspaceBootstrapState {
  setWorkspaces: Dispatch<SetStateAction<Workspace[]>>;
  setTasks: Dispatch<SetStateAction<Task[]>>;
  setWorkspace: Dispatch<SetStateAction<Workspace | undefined>>;
  setTask: Dispatch<SetStateAction<Task | undefined>>;
  setLoading: Dispatch<SetStateAction<boolean>>;
  setError: Dispatch<SetStateAction<string | undefined>>;
}

export function useWorkspaceBootstrap({ setWorkspaces, setTasks, setWorkspace, setTask, setLoading, setError }: WorkspaceBootstrapState): void {
  useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        const nextWorkspaces = await window.lotagate.workspaces.list();
        const nextTasks = await window.lotagate.tasks.list();
        if (!mounted) return;
        const preferredWorkspace = nextWorkspaces.find(item => item.trusted) ?? nextWorkspaces[0];
        setWorkspaces(nextWorkspaces);
        setTasks(nextTasks);
        setWorkspace(preferredWorkspace);
        setTask(undefined);
      } catch (reason) {
        if (mounted) setError(toUserErrorMessage(reason));
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, [setError, setLoading, setTask, setTasks, setWorkspace, setWorkspaces]);
}
