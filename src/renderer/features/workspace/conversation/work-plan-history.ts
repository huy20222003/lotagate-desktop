import { DESKTOP_TURN_TIMING_METADATA_KEY, type Activity, type WorkPlanSnapshot } from '../../../../contracts/ipc/v1/workspace.js';
import { applyWorkPlanEvent } from '../orchestration/orchestration-events.js';

export function restoreWorkPlan(activities: readonly Activity[]): WorkPlanSnapshot | undefined {
  let current: WorkPlanSnapshot | undefined;
  for (const activity of activities) {
    const turnId = readTurnId(activity);
    if (current?.turnId === turnId && isTerminalTurnMarker(activity.metadata[DESKTOP_TURN_TIMING_METADATA_KEY])) current = undefined;
    const event = typeof activity.metadata['orchestrationEvent'] === 'string' ? activity.metadata['orchestrationEvent'] : undefined;
    if (event !== undefined) current = applyWorkPlanEvent(current, event, activity.metadata);
  }
  return current;
}

function readTurnId(activity: Activity): string | undefined {
  return typeof activity.metadata['turnId'] === 'string' ? activity.metadata['turnId'] : undefined;
}

function isTerminalTurnMarker(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const phase = (value as Record<string, unknown>)['phase'];
  return phase === 'failed' || phase === 'cancelled';
}
