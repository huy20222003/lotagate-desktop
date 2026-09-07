import type { Activity } from '../../../../contracts/ipc/v1/workspace.js';
import { DESKTOP_CONTEXT_COMPACTION_ID_METADATA_KEY, DESKTOP_CONTEXT_COMPACTION_PHASE_METADATA_KEY } from '../../../../contracts/ipc/v1/workspace.js';

export type ContextCompactionPhase = 'compacting' | 'compacted';

export function contextCompactionActivityId(taskId: string, turnId: string): string {
  return `context-compaction:${taskId}:${turnId}`;
}

export function createContextCompactionActivity(taskId: string, turnId: string, phase: ContextCompactionPhase, createdAt = new Date().toISOString()): Activity {
  return {
    id: contextCompactionActivityId(taskId, turnId),
    taskId,
    kind: 'context',
    text: phase === 'compacting' ? 'Context automatically compacting.' : 'Context automatically compacted.',
    metadata: {
      turnId,
      [DESKTOP_CONTEXT_COMPACTION_ID_METADATA_KEY]: turnId,
      [DESKTOP_CONTEXT_COMPACTION_PHASE_METADATA_KEY]: phase,
    },
    createdAt,
  };
}

export function upsertContextCompactionActivity(activities: readonly Activity[], taskId: string, turnId: string, phase: ContextCompactionPhase): Activity[] {
  const id = contextCompactionActivityId(taskId, turnId);
  const index = activities.findIndex(activity => activity.id === id);
  const previous = index < 0 ? undefined : activities[index];
  const next = createContextCompactionActivity(taskId, turnId, phase, previous?.createdAt);
  if (index < 0) return [...activities, next];
  const updated = [...activities];
  updated[index] = next;
  return updated;
}

export function isContextCompactionActivity(activity: Activity): boolean {
  return activity.kind === 'context'
    && typeof activity.metadata[DESKTOP_CONTEXT_COMPACTION_ID_METADATA_KEY] === 'string'
    && typeof activity.metadata[DESKTOP_CONTEXT_COMPACTION_PHASE_METADATA_KEY] === 'string';
}

export function contextCompactionPhase(activity: Activity): ContextCompactionPhase | undefined {
  if (!isContextCompactionActivity(activity)) return undefined;
  const phase = activity.metadata[DESKTOP_CONTEXT_COMPACTION_PHASE_METADATA_KEY];
  return phase === 'compacting' || phase === 'compacted' ? phase : undefined;
}
