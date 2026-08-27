import type { Activity, DesktopTurnTimingMarker } from '../../../contracts/ipc/v1/workspace.js';
import { DESKTOP_TURN_TIMING_METADATA_KEY } from '../../../contracts/ipc/v1/workspace.js';

export interface TurnTiming { startedAt: number; endedAt?: number }

export function turnTimingsFromActivities(activities: readonly Activity[]): Record<string, TurnTiming> {
  const timings: Record<string, TurnTiming> = {};
  for (const activity of activities) {
    const turnId = activity.metadata['turnId'];
    const marker = activity.metadata[DESKTOP_TURN_TIMING_METADATA_KEY];
    if (typeof turnId !== 'string' || turnId.length === 0 || !isTurnTimingMarker(marker)) continue;
    const current = timings[turnId];
    if (marker.phase === 'started') timings[turnId] = { startedAt: current?.startedAt ?? marker.timestampMs };
    else timings[turnId] = { startedAt: current?.startedAt ?? marker.timestampMs, endedAt: marker.timestampMs };
  }
  return timings;
}

function isTurnTimingMarker(value: unknown): value is DesktopTurnTimingMarker {
  if (typeof value !== 'object' || value === null) return false;
  const marker = value as Record<string, unknown>;
  return (marker['phase'] === 'started' || marker['phase'] === 'completed' || marker['phase'] === 'failed' || marker['phase'] === 'cancelled') && typeof marker['timestampMs'] === 'number' && Number.isFinite(marker['timestampMs']) && marker['timestampMs'] >= 0;
}
