import { useCallback, useEffect, useState } from 'react';
import type { CheckpointStatus, CheckpointUndoResult, Task } from '../../../../contracts/ipc/v1/workspace.js';

export function useWorkspaceCheckpoints(task: Task | undefined, loadActivities: (taskId: string, reset?: boolean) => Promise<void>): { checkpointStatuses: Record<string, CheckpointStatus>; undoingTurns: Record<string, boolean>; refreshCheckpointStatuses: () => Promise<void>; undoFileChanges: (turnId: string) => Promise<CheckpointUndoResult> } {
  const [checkpointStatuses, setCheckpointStatuses] = useState<Record<string, CheckpointStatus>>({});
  const [undoingTurns, setUndoingTurns] = useState<Record<string, boolean>>({});
  const refreshCheckpointStatuses = useCallback(async () => {
    if (task === undefined) { setCheckpointStatuses({}); return; }
    const statuses = await window.lotagate.checkpoints.list(task.cwd, task.id);
    setCheckpointStatuses(Object.fromEntries(statuses.map(status => [status.turnId, status])));
  }, [task]);
  useEffect(() => { let mounted = true; void refreshCheckpointStatuses().catch(() => { if (mounted) setCheckpointStatuses({}); }); return () => { mounted = false; setUndoingTurns({}); }; }, [refreshCheckpointStatuses]);
  const undoFileChanges = useCallback(async (turnId: string): Promise<CheckpointUndoResult> => {
    if (task === undefined) throw new Error('Select a task before undoing file changes.');
    setUndoingTurns(current => ({ ...current, [turnId]: true }));
    try {
      const result = await window.lotagate.checkpoints.undo(task.cwd, task.id, turnId);
      await refreshCheckpointStatuses();
      await loadActivities(task.id, true);
      return result;
    } finally {
      setUndoingTurns(current => { const next = { ...current }; delete next[turnId]; return next; });
    }
  }, [loadActivities, refreshCheckpointStatuses, task]);
  return { checkpointStatuses, undoingTurns, refreshCheckpointStatuses, undoFileChanges };
}
