import { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { Activity } from '../../../contracts/ipc/v1/workspace.js';
import { formatDuration } from '../../utils/time.js';
import { WorkedForDetails } from './WorkedForDetails.js';

export interface TurnTiming { startedAt: number; endedAt?: number | undefined }

export function ElapsedTime({ timing, fallback, statusText, progressActivities = [], toolActivities = [] }: { timing?: TurnTiming | undefined; fallback: string; statusText?: string | undefined; progressActivities?: readonly Activity[]; toolActivities?: readonly Activity[] }) {
  const startedAt = timing?.startedAt ?? Date.parse(fallback);
  const [now, setNow] = useState(Date.now());
  const active = timing !== undefined && timing.endedAt === undefined;
  const [expanded, setExpanded] = useState(active);
  useEffect(() => {
    if (timing?.endedAt !== undefined) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [timing?.endedAt]);
  useEffect(() => { setExpanded(active); }, [active, timing?.startedAt, timing?.endedAt]);
  const end = timing?.endedAt ?? (timing ? now : startedAt);
  return <details className="worked-time" open={expanded} onToggle={event => setExpanded(event.currentTarget.open)}><summary><span>Worked for {formatDuration(Math.max(0, end - startedAt))}</span><span className="worked-time-chevron" aria-hidden="true">{expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</span></summary><WorkedForDetails active={active} statusText={statusText} progressActivities={progressActivities} toolActivities={toolActivities} /></details>;
}
