import { DESKTOP_COMMAND_TIMING_METADATA_KEY, type Activity } from '../../../../contracts/ipc/v1/workspace.js';
import { readString } from '../../../utils/data.js';
import type { TurnTiming } from './ElapsedTime.js';

export function findActiveTurnTiming(turnTimings: Record<string, TurnTiming>): TurnTiming | undefined {
  return Object.values(turnTimings).filter(timing => timing.endedAt === undefined).sort((left, right) => right.startedAt - left.startedAt)[0];
}

export function messageTiming(activity: Activity, turnTimings: Record<string, TurnTiming>): { timing?: TurnTiming | undefined } {
  if (activity.kind !== 'assistant' && activity.kind !== 'error') return {};
  const timing = turnTimings[String(activity.metadata['turnId'] ?? '')];
  if (timing !== undefined) return { timing };
  const commandTiming = activity.metadata[DESKTOP_COMMAND_TIMING_METADATA_KEY];
  if (!isCommandTiming(commandTiming)) return {};
  return { timing: commandTiming };
}

export function activityTurnId(activity: Activity): string | undefined {
  return readString(activity.metadata['turnId']);
}

function isCommandTiming(value: unknown): value is TurnTiming {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record['startedAt'] === 'number' && Number.isFinite(record['startedAt'])
    && typeof record['endedAt'] === 'number' && Number.isFinite(record['endedAt'])
    && record['endedAt'] >= record['startedAt'];
}
