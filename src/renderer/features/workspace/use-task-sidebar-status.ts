import { useCallback, useEffect, useState } from 'react';

export function useTaskSidebarStatus(selectedTaskId?: string) {
  const [runningTaskIds, setRunningTaskIds] = useState<ReadonlySet<string>>(new Set());
  const [unreadTaskIds, setUnreadTaskIds] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    if (selectedTaskId === undefined) return;
    setUnreadTaskIds(current => {
      if (!current.has(selectedTaskId)) return current;
      const next = new Set(current);
      next.delete(selectedTaskId);
      return next;
    });
  }, [selectedTaskId]);

  const markTurnStarted = useCallback((taskId: string) => {
    setRunningTaskIds(current => new Set(current).add(taskId));
    setUnreadTaskIds(current => {
      if (!current.has(taskId)) return current;
      const next = new Set(current);
      next.delete(taskId);
      return next;
    });
  }, []);

  const markTurnFinished = useCallback((taskId: string, completed: boolean, viewedTaskId?: string) => {
    setRunningTaskIds(current => {
      if (!current.has(taskId)) return current;
      const next = new Set(current);
      next.delete(taskId);
      return next;
    });
    if (completed && taskId !== viewedTaskId) setUnreadTaskIds(current => new Set(current).add(taskId));
  }, []);

  return { runningTaskIds, unreadTaskIds, markTurnStarted, markTurnFinished };
}
