import type { Activity } from '../../../../contracts/ipc/v1/workspace.js';

const TRANSIENT_SYSTEM_STATUS = new Set([
  'Agent turn completed.',
  'Command completed.',
  'Command failed.',
  'Command cancelled.',
  'Command step completed.',
  'Command step failed.',
  'Running command…',
]);

export function mergeChatActivities(activities: Activity[]): Activity[] {
  const transcript: Activity[] = [];
  for (const activity of activities) {
    if (activity.kind !== 'user' && activity.kind !== 'assistant' && activity.kind !== 'error') continue;
    if (isAssistantProgressActivity(activity)) continue;
    if (isTransientSystemActivity(activity)) continue;
    const previous = transcript[transcript.length - 1];
    const currentTurnId = readTurnId(activity);
    const previousTurnId = previous === undefined ? undefined : readTurnId(previous);
    const currentSegmentId = readSegmentId(activity);
    const previousSegmentId = previous === undefined ? undefined : readSegmentId(previous);
    const sameSegment = activity.kind === 'error'
      || currentSegmentId === previousSegmentId
      || (activity.kind === 'assistant' && previous?.kind === 'assistant' && isInterruptedAssistantActivity(activity) && isInterruptedAssistantActivity(previous));
    if (currentTurnId !== undefined && currentTurnId === previousTurnId && sameSegment && (activity.kind === 'assistant' || activity.kind === 'error') && previous?.kind === 'assistant') {
      const separator = activity.kind === 'error' || isInterruptedAssistantActivity(activity) ? `\n\n${activity.text}` : activity.text;
      transcript[transcript.length - 1] = { ...previous, text: `${previous.text}${separator}`, metadata: { ...previous.metadata, ...activity.metadata } };
    } else transcript.push(activity);
  }
  return transcript;
}

export function isAssistantProgressActivity(activity: Activity): boolean {
  return activity.kind === 'assistant'
    && activity.metadata['assistantPhase'] === 'progress'
    && activity.metadata['assistantInterrupted'] !== true;
}

export function activitiesForUserTurn(activities: readonly Activity[], userActivity: Activity): Activity[] {
  if (userActivity.kind !== 'user') return [];
  const userIndex = activities.findIndex(activity => activity.id === userActivity.id);
  if (userIndex < 0) return [];
  const nextUserIndex = activities.findIndex((activity, index) => index > userIndex && activity.kind === 'user');
  return [...activities.slice(userIndex + 1, nextUserIndex < 0 ? activities.length : nextUserIndex)];
}

function isInterruptedAssistantActivity(activity: Activity): boolean {
  return activity.kind === 'assistant' && activity.metadata['assistantInterrupted'] === true;
}

export function readSegmentId(activity: Activity): string | undefined {
  const value = activity.metadata['segmentId'];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function isTransientSystemActivity(activity: Activity): boolean {
  if (activity.kind !== 'assistant' && activity.kind !== 'error') return false;
  return TRANSIENT_SYSTEM_STATUS.has(normalizeTransientStatus(activity.text));
}

function normalizeTransientStatus(text: string): string {
  return text.trim().replace(/\.{3}$/u, '…');
}

function readTurnId(activity: Activity): string | undefined {
  const value = activity.metadata['turnId'];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
