import { Fragment, useMemo } from 'react';
import type { Activity, Artifact, CheckpointStatus, SubagentSnapshot, Task, TrustRequest } from '../../../../contracts/ipc/v1/workspace.js';
import { EmptyState } from '../../../components/ui.js';
import type { AttachmentPreview } from '../../../services/attachment-types.js';
import type { FileChangeSummariesByTurn } from '../review/file-changes.js';
import { isAssistantProgressActivity, mergeChatActivities } from './conversation-activities.js';
import { TrustCard } from '../shell/WorkspaceOverlays.js';
import { ChatMessage } from './ChatMessage.js';
import { ContextCompactionIndicator } from './ContextCompactionIndicator.js';
import { ElapsedTime, type TurnTiming } from './ElapsedTime.js';
import { findActiveTurnTiming, activityTurnId, messageTiming } from './conversation-timing.js';
import { TypingIndicator } from './TypingIndicator.js';
import { hasRunningWorkedTool } from './WorkedForDetails.js';
import type { OpenFileChangesHandler } from '../review/file-change-view.js';
import { ConversationTimeSeparator } from './ConversationTimeSeparator.js';
import { getConversationTimeSeparatorIds } from './conversation-time.js';

const EMPTY_ATTACHMENTS: AttachmentPreview[] = [];
const EMPTY_ARTIFACTS: Artifact[] = [];
const EMPTY_ACTIVITIES: Activity[] = [];

interface TurnActivityDetails {
  all: Activity[];
  progress: Activity[];
  tools: Activity[];
}

export function TaskConversation({ task, projectRoot, activities, activityAttachments, activityArtifacts, fileChangesByTurn, checkpointStatuses = {}, undoingTurns = {}, onUndoFileChanges = async () => undefined, onOpenFileChanges, statusText, contextCompactionStatus, thinking, finalResponseReceived, thinkingStartedAt, turnTimings, trust, onTrust, subagents = [] }: { task?: Task | undefined; projectRoot?: string | undefined; activities: Activity[]; activityAttachments: Record<string, AttachmentPreview[]>; activityArtifacts: Record<string, Artifact[]>; fileChangesByTurn: FileChangeSummariesByTurn; checkpointStatuses?: Record<string, CheckpointStatus>; undoingTurns?: Record<string, boolean>; onUndoFileChanges?: (turnId: string) => Promise<void>; onOpenFileChanges: OpenFileChangesHandler; statusText?: string | undefined; contextCompactionStatus?: 'compacting' | 'compacted' | 'failed' | undefined; thinking: boolean; finalResponseReceived: boolean; thinkingStartedAt?: number | undefined; turnTimings: Record<string, TurnTiming>; trust?: TrustRequest | undefined; onTrust: (trusted: boolean) => Promise<void>; subagents?: readonly SubagentSnapshot[] }) {
  const transcript = useMemo(() => mergeChatActivities(activities), [activities]);
  const conversationTimeSeparatorIds = useMemo(() => getConversationTimeSeparatorIds(transcript), [transcript]);
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
  const hasRunningTool = hasRunningWorkedTool(liveToolActivities);
  const hasActiveAssistant = transcript.some(activity => {
    if (activity.kind !== 'assistant') return false;
    const timing = messageTiming(activity, turnTimings).timing;
    return timing !== undefined && timing.endedAt === undefined;
  });
  const messageWorkspaceRoot = projectRoot ?? task.cwd;
  const messages = transcript.map(activity => {
    const turnId = activityTurnId(activity);
    const turnDetails = turnId === undefined ? undefined : activityDetailsByTurn.get(turnId);
    const turnActivities = turnDetails?.all ?? EMPTY_ACTIVITIES;
    const fileChangeSummary = !thinking && (activity.kind === 'assistant' || activity.kind === 'error') && turnId !== undefined ? fileChangesByTurn[turnId] : undefined;
    return <Fragment key={activity.id}>{conversationTimeSeparatorIds.has(activity.id) ? <ConversationTimeSeparator timestamp={activity.createdAt} /> : null}<ChatMessage activity={activity} attachments={activityAttachments[activity.id] ?? EMPTY_ATTACHMENTS} artifacts={activityArtifacts[activity.id] ?? EMPTY_ARTIFACTS} workspaceCwd={messageWorkspaceRoot} onUndoFileChanges={onUndoFileChanges} undoState={turnId === undefined ? undefined : checkpointStatuses[turnId]?.state} undoBusy={turnId === undefined ? false : undoingTurns[turnId] === true} onOpenFileChanges={onOpenFileChanges} activities={turnActivities} {...(fileChangeSummary === undefined ? {} : { fileChangeSummary })} {...messageTiming(activity, turnTimings)} /></Fragment>;
  });
  const showLiveWorkedFor = thinking && workingTiming !== undefined && !hasActiveAssistant;
  const showTypingIndicator = thinking && !finalResponseReceived && !hasRunningTool && !hasActiveAssistant;
  // Tool activities own the Worked For detail once an action has started or
  // completed. Keeping the generic tool status here duplicates lines such as
  // "Read file · completed" above the grouped command/tool activity.
  const liveStatusText = liveProgressActivities.length === 0 && liveToolActivities.length === 0 ? statusText : undefined;
  const typingStatusText = hasLiveWorkDetails ? undefined : statusText;
  return <><div className="activity-list">{messages}</div><div className={`conversation-live-status${thinking ? ' is-thinking' : ''}`}>{showLiveWorkedFor ? <ElapsedTime timing={workingTiming} fallback={task.createdAt} statusText={hasLiveWorkDetails ? liveStatusText : undefined} activities={liveTurnDetails?.all ?? EMPTY_ACTIVITIES} subagents={subagents} /> : null}{contextCompactionStatus ? <ContextCompactionIndicator phase={contextCompactionStatus} /> : null}{showTypingIndicator ? typingStatusText ? <TypingIndicator label={typingStatusText} /> : <TypingIndicator /> : null}{trust ? <TrustCard request={trust} onDecision={onTrust} /> : null}</div></>;
}
