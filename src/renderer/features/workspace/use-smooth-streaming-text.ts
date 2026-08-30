import { useEffect, useMemo, useState } from 'react';

const STREAM_FRAME_MS = 16;
const STREAM_INITIAL_CODE_POINTS = 64;
const STREAM_CODE_POINTS_PER_FRAME = 8;

/** Reveals a live response on frame-sized updates while preserving the real target text. */
export function useSmoothStreamingText(target: string, active: boolean): string {
  const codePoints = useMemo(() => Array.from(target), [target]);
  const [visibleCount, setVisibleCount] = useState(() => active ? Math.min(codePoints.length, STREAM_INITIAL_CODE_POINTS) : codePoints.length);

  useEffect(() => {
    setVisibleCount(current => Math.min(current, codePoints.length));
  }, [codePoints.length]);

  useEffect(() => {
    if (visibleCount >= codePoints.length) return;
    const timer = window.setTimeout(() => {
      setVisibleCount(current => Math.min(codePoints.length, current + STREAM_CODE_POINTS_PER_FRAME));
    }, STREAM_FRAME_MS);
    return () => window.clearTimeout(timer);
  }, [codePoints, visibleCount]);

  return codePoints.slice(0, visibleCount).join('');
}
