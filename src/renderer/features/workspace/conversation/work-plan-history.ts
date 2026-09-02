import type { Activity, WorkPlanSnapshot } from '../../../../contracts/ipc/v1/workspace.js';
import { applyWorkPlanEvent } from '../orchestration/orchestration-events.js';

export function restoreWorkPlan(activities: readonly Activity[]): WorkPlanSnapshot | undefined {
  return activities.reduce<WorkPlanSnapshot | undefined>((current, activity) => {
    const event = typeof activity.metadata['orchestrationEvent'] === 'string' ? activity.metadata['orchestrationEvent'] : undefined;
    return event === undefined ? current : applyWorkPlanEvent(current, event, activity.metadata);
  }, undefined);
}
