import { useCallback, useEffect, useRef } from 'react';

/** Coalesces high-frequency stream updates before publishing them to React state. */
export function useDeferredStatePublisher<T>(publishState: (value: T) => void): (value: T, deferred?: boolean) => void {
  const pendingRef = useRef<T | undefined>();
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>();

  const cancel = useCallback(() => {
    if (timerRef.current !== undefined) {
      clearTimeout(timerRef.current);
      timerRef.current = undefined;
    }
    pendingRef.current = undefined;
  }, []);

  const publish = useCallback((value: T, deferred = false) => {
    if (!deferred) {
      cancel();
      publishState(value);
      return;
    }
    pendingRef.current = value;
    if (timerRef.current !== undefined) return;
    timerRef.current = setTimeout(() => {
      timerRef.current = undefined;
      const pending = pendingRef.current;
      pendingRef.current = undefined;
      if (pending !== undefined) publishState(pending);
    }, 16);
  }, [cancel, publishState]);

  useEffect(() => cancel, [cancel]);
  return publish;
}
