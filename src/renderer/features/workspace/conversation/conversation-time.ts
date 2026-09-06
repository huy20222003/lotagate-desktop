import type { Activity } from '../../../../contracts/ipc/v1/workspace.js';

export const CONVERSATION_TIME_SEPARATOR_THRESHOLD_MS = 3 * 60 * 60 * 1_000;

export function getConversationTimeSeparatorIds(activities: readonly Activity[]): ReadonlySet<string> {
  const separatorIds = new Set<string>();
  let previousAgentResponse: Activity | undefined;

  activities.forEach((activity, index) => {
    if (activity.kind === 'user' && (index === 0 || shouldSeparateFromPreviousResponse(activity, previousAgentResponse))) separatorIds.add(activity.id);
    if (isAgentResponse(activity)) previousAgentResponse = activity;
  });

  return separatorIds;
}

function shouldSeparateFromPreviousResponse(activity: Activity, previousAgentResponse: Activity | undefined): boolean {
  if (previousAgentResponse === undefined) return false;
  const messageTime = Date.parse(activity.createdAt);
  const responseTime = Date.parse(previousAgentResponse.createdAt);
  return Number.isFinite(messageTime) && Number.isFinite(responseTime) && messageTime - responseTime >= CONVERSATION_TIME_SEPARATOR_THRESHOLD_MS;
}

function isAgentResponse(activity: Activity): boolean {
  return activity.kind === 'assistant' || activity.kind === 'error';
}
