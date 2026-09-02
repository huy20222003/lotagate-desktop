import { useCallback, useEffect, useRef } from 'react';

const ACTIVITY_REFRESH_MIN_INTERVAL_MS = 250;

type LoadActivities = (taskId: string, reset?: boolean) => Promise<void>;

/** Coalesces lifecycle refreshes while keeping streaming deltas on the local render path. */
export function useActivityRefreshScheduler(loadActivities: LoadActivities, onError: (reason: unknown) => void, scopeKey?: string): (taskId: string) => void {
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>();
  const inFlightRef = useRef<Promise<void> | undefined>();
  const pendingTaskIdRef = useRef<string | undefined>();
  const lastRefreshAtRef = useRef(0);

  const schedule = useCallback((taskId: string) => {
    pendingTaskIdRef.current = taskId;
    if (timerRef.current !== undefined || inFlightRef.current !== undefined) return;
    const run = () => {
      timerRef.current = undefined;
      const refreshTaskId = pendingTaskIdRef.current;
      pendingTaskIdRef.current = undefined;
      if (refreshTaskId === undefined) return;
      lastRefreshAtRef.current = Date.now();
      const refresh = loadActivities(refreshTaskId, false).catch(reason => { onError(reason); });
      inFlightRef.current = refresh;
      void refresh.finally(() => {
        if (inFlightRef.current === refresh) inFlightRef.current = undefined;
        if (pendingTaskIdRef.current !== undefined && timerRef.current === undefined) {
          const elapsed = Date.now() - lastRefreshAtRef.current;
          timerRef.current = setTimeout(run, Math.max(0, ACTIVITY_REFRESH_MIN_INTERVAL_MS - elapsed));
        }
      });
    };
    const elapsed = Date.now() - lastRefreshAtRef.current;
    timerRef.current = setTimeout(run, Math.max(0, ACTIVITY_REFRESH_MIN_INTERVAL_MS - elapsed));
  }, [loadActivities, onError]);

  useEffect(() => () => {
    if (timerRef.current !== undefined) { clearTimeout(timerRef.current); timerRef.current = undefined; }
    pendingTaskIdRef.current = undefined;
  }, [scopeKey]);

  return schedule;
}
