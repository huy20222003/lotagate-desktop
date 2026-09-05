import type { Activity } from '../../../../contracts/ipc/v1/workspace.js';

export interface PendingAssistantStream {
  taskId: string;
  turnId?: string;
  segmentId?: string;
  metadata?: Readonly<Record<string, unknown>>;
  text: string;
  createdAt: string;
}

export interface AssistantDeltaInput {
  taskId: string;
  turnId?: string;
  segmentId?: string;
  iteration?: number;
  content: string;
  createdAt: string;
  metadata?: Readonly<Record<string, unknown>>;
}

export interface AssistantSegmentPhaseInput {
  taskId: string;
  turnId?: string;
  segmentId: string;
  phase: 'progress' | 'final';
}

export function appendAssistantDelta(activities: readonly Activity[], input: AssistantDeltaInput): Activity[] {
  if (input.content.length === 0) return [...activities];
  const index = findAssistantIndex(activities, input.taskId, input.turnId, input.segmentId);
  if (index >= 0) {
    const activity = activities[index];
    if (activity === undefined) return [...activities];
    const next = [...activities];
    next[index] = { ...activity, text: `${activity.text}${input.content}`, metadata: { ...activity.metadata, ...input.metadata, ...(input.turnId === undefined ? {} : { turnId: input.turnId }), ...(input.segmentId === undefined ? {} : { segmentId: input.segmentId, assistantPhase: 'progress' }), ...(input.iteration === undefined ? {} : { iteration: input.iteration }) } };
    return next;
  }
  return [...activities, {
    id: `streaming:${input.taskId}:${input.segmentId ?? input.turnId ?? 'active'}`,
    taskId: input.taskId,
    kind: 'assistant',
    text: input.content,
    metadata: { ...input.metadata, ...(input.turnId === undefined ? {} : { turnId: input.turnId }), ...(input.segmentId === undefined ? {} : { segmentId: input.segmentId, assistantPhase: 'progress' }), ...(input.iteration === undefined ? {} : { iteration: input.iteration }) },
    createdAt: input.createdAt,
  }];
}

export function reconcilePendingAssistantStreams(activities: readonly Activity[], streams: readonly PendingAssistantStream[]): Activity[] {
  return streams.reduce((current, stream) => {
    const index = findAssistantIndex(current, stream.taskId, stream.turnId, stream.segmentId);
    if (index < 0) return appendAssistantDelta(current, { taskId: stream.taskId, ...(stream.turnId === undefined ? {} : { turnId: stream.turnId }), ...(stream.segmentId === undefined ? {} : { segmentId: stream.segmentId }), ...(stream.metadata === undefined ? {} : { metadata: stream.metadata }), content: stream.text, createdAt: stream.createdAt });
    const activity = current[index];
    if (activity === undefined || activity.text.length >= stream.text.length) return current;
    const next = [...current];
    next[index] = { ...activity, text: stream.text };
    return next;
  }, [...activities]);
}

export function isAssistantStreamPersisted(activities: readonly Activity[], stream: PendingAssistantStream): boolean {
  const index = findAssistantIndex(activities, stream.taskId, stream.turnId, stream.segmentId);
  return index >= 0 && (activities[index]?.text.length ?? 0) >= stream.text.length;
}

export function assistantStreamKey(taskId: string, turnId?: string, segmentId?: string): string {
  return `${taskId}:${segmentId ?? turnId ?? 'active'}`;
}

export function markAssistantSegmentPhase(activities: readonly Activity[], input: AssistantSegmentPhaseInput): Activity[] {
  const index = findAssistantIndex(activities, input.taskId, input.turnId, input.segmentId);
  if (index < 0) return [...activities];
  const activity = activities[index];
  if (activity === undefined) return [...activities];
  const next = [...activities];
  next[index] = { ...activity, metadata: { ...activity.metadata, assistantPhase: input.phase } };
  return next;
}

function findAssistantIndex(activities: readonly Activity[], taskId: string, turnId?: string, segmentId?: string): number {
  for (let index = activities.length - 1; index >= 0; index -= 1) {
    const activity = activities[index];
    if (activity?.taskId !== taskId || activity.kind !== 'assistant') continue;
    if (segmentId !== undefined && activity.metadata['segmentId'] === segmentId) return index;
    if (segmentId === undefined && readTurnId(activity) === turnId) return index;
  }
  return -1;
}

function readTurnId(activity: Activity): string | undefined {
  const value = activity.metadata['turnId'];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
