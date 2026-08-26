import type { Activity } from '../../../contracts/ipc/v1/workspace.js';

export function mergeChatActivities(activities: Activity[]): Activity[] {
  const transcript: Activity[] = [];
  for (const activity of activities) {
    if (activity.kind !== 'user' && activity.kind !== 'assistant' && activity.kind !== 'error') continue;
    if (activity.kind === 'assistant' && activity.text.trim() === 'Agent turn completed.') continue;
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

function readTurnId(activity: Activity): string | undefined {
  const value = activity.metadata['turnId'];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
