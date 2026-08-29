import { useCallback, useEffect, useRef, type MutableRefObject } from 'react';
import type { Task } from '../../../contracts/ipc/v1/workspace.js';

const DRAFT_PERSISTENCE_DEBOUNCE_MS = 250;

interface DraftPersistenceOptions {
  taskRef: MutableRefObject<Task | undefined>;
  ensureDraftTask: () => Promise<Task | undefined>;
  onError: (reason: unknown) => void;
}

/** Debounces draft IPC writes without delaying the in-memory composer state. */
export function useDraftPersistence({ taskRef, ensureDraftTask, onError }: DraftPersistenceOptions): { updateDraft: (draft: string) => Promise<void>; flushDraft: () => Promise<void> } {
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>();
  const pendingRef = useRef<{ taskId: string; draft: string } | undefined>();
  const writeRef = useRef<Promise<void>>(Promise.resolve());

  const flushDraft = useCallback(async (): Promise<void> => {
    if (timerRef.current !== undefined) { clearTimeout(timerRef.current); timerRef.current = undefined; }
    const pending = pendingRef.current;
    if (pending === undefined) { await writeRef.current; return; }
    pendingRef.current = undefined;
    const write = writeRef.current.catch(reason => { onError(reason); }).then(async () => {
      const next = await window.lotagate.tasks.update(pending.taskId, { draft: pending.draft });
      if (taskRef.current?.id === pending.taskId) taskRef.current = next;
    });
    writeRef.current = write;
    await write;
    if (pendingRef.current !== undefined) await flushDraft();
  }, [onError, taskRef]);

  const updateDraft = useCallback(async (draft: string) => {
    const activeTask = await ensureDraftTask();
    if (!activeTask) return;
    taskRef.current = { ...activeTask, draft };
    pendingRef.current = { taskId: activeTask.id, draft };
    if (timerRef.current !== undefined) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => { timerRef.current = undefined; void flushDraft().catch(onError); }, DRAFT_PERSISTENCE_DEBOUNCE_MS);
  }, [ensureDraftTask, flushDraft, onError, taskRef]);

  useEffect(() => () => { void flushDraft().catch(onError); }, [flushDraft, onError]);
  return { updateDraft, flushDraft };
}
