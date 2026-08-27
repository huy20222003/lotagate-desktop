import { useEffect, useState } from 'react';
import { formatDuration } from '../../utils/time.js';

export interface TurnTiming { startedAt: number; endedAt?: number | undefined }

export function ElapsedTime({ timing, fallback }: { timing?: TurnTiming | undefined; fallback: string }) {
  const startedAt = timing?.startedAt ?? Date.parse(fallback);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (timing?.endedAt !== undefined) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [timing?.endedAt]);
  const end = timing?.endedAt ?? (timing ? now : startedAt);
  return <div className="worked-time">Worked for {formatDuration(Math.max(0, end - startedAt))}</div>;
}
