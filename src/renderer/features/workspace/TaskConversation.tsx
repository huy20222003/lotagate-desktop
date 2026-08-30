import { useMemo } from 'react';
import type { Activity, Artifact, CheckpointStatus, FileChangeSummary, Task, TrustRequest } from '../../../contracts/ipc/v1/workspace.js';
import { EmptyState } from '../../components/ui.js';
import type { AttachmentPreview } from './attachment-types.js';
import type { FileChangeSummariesByTurn } from './file-changes.js';
import { isAssistantProgressActivity, mergeChatActivities } from './conversation-activities.js';
import { FileChangeCard, TrustCard } from './WorkspaceOverlays.js';
import { ChatMessage } from './ChatMessage.js';
import { ContextCompactionIndicator } from './ContextCompactionIndicator.js';
import { ElapsedTime, type TurnTiming } from './ElapsedTime.js';
import { findActiveTurnTiming, activityTurnId, messageTiming } from './conversation-timing.js';
import { TypingIndicator } from './TypingIndicator.js';

const EMPTY_ATTACHMENTS: AttachmentPreview[] = [];
const EMPTY_ARTIFACTS: Artifact[] = [];
const EMPTY_ACTIVITIES: Activity[] = [];

interface TurnActivityDetails {
  all: Activity[];
  progress: Activity[];
  tools: Activity[];
}

export function TaskConversation({ task, activities, activityAttachments, activityArtifacts, fileChangesByTurn, checkpointStatuses = {}, undoingTurns = {}, onUndoFileChanges = async () => undefined, onOpenFileChanges, onOpenImage, statusText, contextCompactionStatus, thinking, thinkingStartedAt, turnTimings, trust, onTrust }: { task?: Task | undefined; activities: Activity[]; activityAttachments: Record<string, AttachmentPreview[]>; activityArtifacts: Record<string, Artifact[]>; fileChangesByTurn: FileChangeSummariesByTurn; checkpointStatuses?: Record<string, CheckpointStatus>; undoingTurns?: Record<string, boolean>; onUndoFileChanges?: (turnId: string) => Promise<void>; onOpenFileChanges: (summary: FileChangeSummary) => void; onOpenImage: (attachment: AttachmentPreview) => void; statusText?: string | undefined; contextCompactionStatus?: 'compacting' | 'compacted' | 'failed' | undefined; thinking: boolean; thinkingStartedAt?: number | undefined; turnTimings: Record<string, TurnTiming>; trust?: TrustRequest | undefined; onTrust: (trusted: boolean) => Promise<void> }) {
  const transcript = useMemo(() => mergeChatActivities(activities), [activities]);
  const activityDetailsByTurn = useMemo(() => {
    const grouped = new Map<string, TurnActivityDetails>();
    for (const activity of activities) {
      const turnId = activityTurnId(activity);
      if (turnId === undefined) continue;
      const current = grouped.get(turnId) ?? { all: [], progress: [], tools: [] };
      current.all.push(activity);
      if (isAssistantProgressActivity(activity)) current.progress.push(activity);
      if (activity.kind === 'tool') current.tools.push(activity);
      grouped.set(turnId, current);
    }
    return grouped;
  }, [activities]);
  if (!task) return <EmptyState title="Create your first agent task" detail="Choose a workspace, then enter a prompt below." />;
  const activeTiming = findActiveTurnTiming(turnTimings);
  const workingTiming = activeTiming ?? (thinkingStartedAt === undefined ? undefined : { startedAt: thinkingStartedAt });
  const activeTurnId = Object.entries(turnTimings)
    .filter(([, timing]) => timing.endedAt === undefined)
    .sort(([, left], [, right]) => right.startedAt - left.startedAt)[0]?.[0];
  const liveTurnDetails = activeTurnId === undefined ? undefined : activityDetailsByTurn.get(activeTurnId);
  const liveProgressActivities = liveTurnDetails?.progress ?? EMPTY_ACTIVITIES;
  const liveToolActivities = liveTurnDetails?.tools ?? EMPTY_ACTIVITIES;
  const hasLiveWorkDetails = liveProgressActivities.length > 0 || liveToolActivities.length > 0;
  const hasActiveAssistant = transcript.some(activity => {
    if (activity.kind !== 'assistant') return false;
    const timing = messageTiming(activity, turnTimings).timing;
    return timing !== undefined && timing.endedAt === undefined;
  });
  const renderedTurnIds = new Set<string>();
  const messages = transcript.map(activity => {
    const turnId = activityTurnId(activity);
    const turnDetails = turnId === undefined ? undefined : activityDetailsByTurn.get(turnId);
    const progressActivities = turnDetails?.progress ?? EMPTY_ACTIVITIES;
    const toolActivities = turnDetails?.tools ?? EMPTY_ACTIVITIES;
    const fileChangeSummary = !thinking && activity.kind === 'assistant' && turnId !== undefined ? fileChangesByTurn[turnId] : undefined;
    if (fileChangeSummary !== undefined && turnId !== undefined) renderedTurnIds.add(turnId);
    return <ChatMessage key={activity.id} activity={activity} attachments={activityAttachments[activity.id] ?? EMPTY_ATTACHMENTS} artifacts={activityArtifacts[activity.id] ?? EMPTY_ARTIFACTS} workspaceCwd={task.cwd} onUndoFileChanges={onUndoFileChanges} undoState={turnId === undefined ? undefined : checkpointStatuses[turnId]?.state} undoBusy={turnId === undefined ? false : undoingTurns[turnId] === true} onOpenFileChanges={onOpenFileChanges} onOpenImage={onOpenImage} progressActivities={progressActivities} toolActivities={toolActivities} {...(fileChangeSummary === undefined ? {} : { fileChangeSummary })} {...messageTiming(activity, turnTimings)} />;
  });
  const unlinkedChanges = !thinking ? Object.entries(fileChangesByTurn).filter(([turnId, summary]) => !renderedTurnIds.has(turnId) && summary.files.length > 0) : [];
  const showLiveWorkedFor = thinking && workingTiming !== undefined && (!hasActiveAssistant || hasLiveWorkDetails);
  const showTypingIndicator = thinking && !hasLiveWorkDetails;
  const liveStatusText = liveProgressActivities.length === 0 ? statusText : undefined;
  return <><div className="activity-list">{messages}{unlinkedChanges.map(([turnId, summary]) => <FileChangeCard key={`changes:${turnId}`} summary={summary} undoBusy={undoingTurns[turnId] === true} {...(checkpointStatuses[turnId]?.state === undefined ? {} : { undoState: checkpointStatuses[turnId].state })} onUndo={() => onUndoFileChanges(turnId)} onOpenFileChanges={onOpenFileChanges} />)}</div><div className={`conversation-live-status${thinking ? ' is-thinking' : ''}`}>{showLiveWorkedFor ? <ElapsedTime timing={workingTiming} fallback={task.createdAt} statusText={hasLiveWorkDetails ? liveStatusText : undefined} progressActivities={liveProgressActivities} toolActivities={liveToolActivities} /> : null}{contextCompactionStatus ? <ContextCompactionIndicator phase={contextCompactionStatus} /> : null}{showTypingIndicator ? statusText ? <TypingIndicator label={statusText} /> : <TypingIndicator /> : null}{trust ? <TrustCard request={trust} onDecision={onTrust} /> : null}</div></>;
}
