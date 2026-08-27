import type { Activity } from '../../../contracts/ipc/v1/workspace.js';

export interface PendingAssistantStream {
  taskId: string;
  turnId?: string;
  text: string;
  createdAt: string;
}

export interface AssistantDeltaInput {
  taskId: string;
  turnId?: string;
  content: string;
  createdAt: string;
}

export function appendAssistantDelta(activities: readonly Activity[], input: AssistantDeltaInput): Activity[] {
  if (input.content.length === 0) return [...activities];
  const index = findAssistantIndex(activities, input.taskId, input.turnId);
  if (index >= 0) {
    return activities.map((activity, activityIndex) => activityIndex === index
      ? { ...activity, text: `${activity.text}${input.content}`, metadata: { ...activity.metadata, ...(input.turnId === undefined ? {} : { turnId: input.turnId }) } }
      : activity);
  }
  return [...activities, {
    id: `streaming:${input.taskId}:${input.turnId ?? 'active'}`,
    taskId: input.taskId,
    kind: 'assistant',
    text: input.content,
    metadata: input.turnId === undefined ? {} : { turnId: input.turnId },
    createdAt: input.createdAt,
  }];
}

export function reconcilePendingAssistantStreams(activities: readonly Activity[], streams: readonly PendingAssistantStream[]): Activity[] {
  return streams.reduce((current, stream) => {
    const index = findAssistantIndex(current, stream.taskId, stream.turnId);
    if (index < 0) return appendAssistantDelta(current, { taskId: stream.taskId, ...(stream.turnId === undefined ? {} : { turnId: stream.turnId }), content: stream.text, createdAt: stream.createdAt });
    const activity = current[index];
    if (activity === undefined || activity.text.length >= stream.text.length) return current;
    return current.map((item, itemIndex) => itemIndex === index ? { ...item, text: stream.text } : item);
  }, [...activities]);
}

export function isAssistantStreamPersisted(activities: readonly Activity[], stream: PendingAssistantStream): boolean {
  const index = findAssistantIndex(activities, stream.taskId, stream.turnId);
  return index >= 0 && (activities[index]?.text.length ?? 0) >= stream.text.length;
}

export function assistantStreamKey(taskId: string, turnId?: string): string {
  return `${taskId}:${turnId ?? 'active'}`;
}

function findAssistantIndex(activities: readonly Activity[], taskId: string, turnId?: string): number {
  for (let index = activities.length - 1; index >= 0; index -= 1) {
    const activity = activities[index];
    if (activity?.taskId === taskId && activity.kind === 'assistant' && readTurnId(activity) === turnId) return index;
  }
  return -1;
}

function readTurnId(activity: Activity): string | undefined {
  const value = activity.metadata['turnId'];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
