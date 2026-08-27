import type { Activity } from '../../../contracts/ipc/v1/workspace.js';
import { readString } from '../../utils/data.js';
import type { TurnTiming } from './ElapsedTime.js';

export function findActiveTurnTiming(turnTimings: Record<string, TurnTiming>): TurnTiming | undefined {
  return Object.values(turnTimings).filter(timing => timing.endedAt === undefined).sort((left, right) => right.startedAt - left.startedAt)[0];
}

export function messageTiming(activity: Activity, turnTimings: Record<string, TurnTiming>): { timing?: TurnTiming | undefined } {
  if (activity.kind !== 'assistant' && activity.kind !== 'error') return {};
  const timing = turnTimings[String(activity.metadata['turnId'] ?? '')];
  return timing === undefined ? {} : { timing };
}

export function activityTurnId(activity: Activity): string | undefined {
  return readString(activity.metadata['turnId']);
}
