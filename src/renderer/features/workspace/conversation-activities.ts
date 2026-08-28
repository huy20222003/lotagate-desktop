import type { Activity } from '../../../contracts/ipc/v1/workspace.js';

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
    if (isTransientSystemActivity(activity)) continue;
    const previous = transcript[transcript.length - 1];
    const currentTurnId = readTurnId(activity);
    const previousTurnId = previous === undefined ? undefined : readTurnId(previous);
    if (currentTurnId !== undefined && currentTurnId === previousTurnId && (activity.kind === 'assistant' || activity.kind === 'error') && previous?.kind === 'assistant') {
      const separator = activity.kind === 'error' ? `\n\n${activity.text}` : activity.text;
      transcript[transcript.length - 1] = { ...previous, text: `${previous.text}${separator}`, metadata: { ...previous.metadata, ...activity.metadata } };
    } else transcript.push(activity);
  }
  return transcript;
}

function isTransientSystemActivity(activity: Activity): boolean {
  return (activity.kind === 'assistant' || activity.kind === 'error') && TRANSIENT_SYSTEM_STATUS.has(activity.text.trim());
}

function readTurnId(activity: Activity): string | undefined {
  const value = activity.metadata['turnId'];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
