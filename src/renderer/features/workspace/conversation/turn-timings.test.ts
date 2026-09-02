import { describe, expect, it } from 'vitest';
import type { Activity } from '../../../../contracts/ipc/v1/workspace.js';
import { DESKTOP_TURN_TIMING_METADATA_KEY } from '../../../../contracts/ipc/v1/workspace.js';
import { turnTimingsFromActivities } from './turn-timings.js';

function markerActivity(id: string, phase: 'started' | 'completed' | 'failed' | 'cancelled', timestampMs: number): Activity {
  return { id, taskId: 'task-1', kind: 'context', text: 'Desktop turn timing marker.', metadata: { turnId: 'turn-1', [DESKTOP_TURN_TIMING_METADATA_KEY]: { phase, timestampMs } }, createdAt: new Date(timestampMs).toISOString() };
}

describe('turnTimingsFromActivities', () => {
  it('restores the elapsed duration from persisted lifecycle markers', () => {
    expect(turnTimingsFromActivities([markerActivity('start', 'started', 1_000), markerActivity('end', 'completed', 4_250)])).toEqual({ 'turn-1': { startedAt: 1_000, endedAt: 4_250 } });
  });

  it('supports terminal failure and cancellation markers', () => {
    expect(turnTimingsFromActivities([markerActivity('start', 'started', 2_000), markerActivity('end', 'failed', 2_800), markerActivity('cancel', 'cancelled', 3_200)])).toEqual({ 'turn-1': { startedAt: 2_000, endedAt: 3_200 } });
  });

  it('ignores malformed metadata without affecting valid turns', () => {
    const malformed = { ...markerActivity('bad', 'started', 2_000), metadata: { turnId: 'turn-bad', [DESKTOP_TURN_TIMING_METADATA_KEY]: { phase: 'started', timestampMs: 'invalid' } } };
    expect(turnTimingsFromActivities([malformed, markerActivity('start', 'started', 5_000)])).toEqual({ 'turn-1': { startedAt: 5_000 } });
  });
});
