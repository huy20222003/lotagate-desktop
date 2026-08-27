import type { Activity, FileChangeSummary, PlanSnapshot, Task, TrustRequest } from '../../../contracts/ipc/v1/workspace.js';
import { EmptyState } from '../../components/ui.js';
import type { AttachmentPreview } from './attachment-types.js';
import type { FileChangeSummariesByTurn } from './file-changes.js';
import { mergeChatActivities } from './conversation-activities.js';
import { FileChangeCard, TrustCard } from './WorkspaceOverlays.js';
import { ChatMessage } from './ChatMessage.js';
import { ContextCompactionIndicator } from './ContextCompactionIndicator.js';
import { ElapsedTime, type TurnTiming } from './ElapsedTime.js';
import { findActiveTurnTiming, activityTurnId, messageTiming } from './conversation-timing.js';
import { TypingIndicator } from './TypingIndicator.js';
import { PlanProgressIndicator } from './PlanProgressIndicator.js';

export function TaskConversation({ task, activities, activityAttachments, fileChangesByTurn, onOpenFileChanges, onOpenImage, statusText, contextCompactionStatus, plan, thinking, thinkingStartedAt, turnTimings, trust, onTrust }: { task?: Task | undefined; activities: Activity[]; activityAttachments: Record<string, AttachmentPreview[]>; fileChangesByTurn: FileChangeSummariesByTurn; onOpenFileChanges: (summary: FileChangeSummary) => void; onOpenImage: (attachment: AttachmentPreview) => void; statusText?: string | undefined; contextCompactionStatus?: 'compacting' | 'compacted' | 'failed' | undefined; plan?: PlanSnapshot | undefined; thinking: boolean; thinkingStartedAt?: number | undefined; turnTimings: Record<string, TurnTiming>; trust?: TrustRequest | undefined; onTrust: (trusted: boolean) => Promise<void> }) {
  if (!task) return <EmptyState title="Create your first agent task" detail="Choose a workspace, then enter a prompt below." />;
  const transcript = mergeChatActivities(activities);
  const activeTiming = findActiveTurnTiming(turnTimings);
  const workingTiming = activeTiming ?? (thinkingStartedAt === undefined ? undefined : { startedAt: thinkingStartedAt });
  const hasActiveAssistant = transcript.some(activity => {
    if (activity.kind !== 'assistant') return false;
    const timing = messageTiming(activity, turnTimings).timing;
    return timing !== undefined && timing.endedAt === undefined;
  });
  const renderedTurnIds = new Set<string>();
  const messages = transcript.map(activity => {
    const turnId = activityTurnId(activity);
    const fileChangeSummary = !thinking && activity.kind === 'assistant' && turnId !== undefined ? fileChangesByTurn[turnId] : undefined;
    if (fileChangeSummary !== undefined && turnId !== undefined) renderedTurnIds.add(turnId);
    return <ChatMessage key={activity.id} activity={activity} attachments={activityAttachments[activity.id] ?? []} onOpenFileChanges={onOpenFileChanges} onOpenImage={onOpenImage} {...(fileChangeSummary === undefined ? {} : { fileChangeSummary })} {...messageTiming(activity, turnTimings)} />;
  });
  const unlinkedChanges = !thinking ? Object.entries(fileChangesByTurn).filter(([turnId, summary]) => !renderedTurnIds.has(turnId) && summary.files.length > 0) : [];
  return <><div className="activity-list">{messages}{unlinkedChanges.map(([turnId, summary]) => <FileChangeCard key={`changes:${turnId}`} summary={summary} onOpenFileChanges={onOpenFileChanges} />)}</div><div className={`conversation-live-status${thinking ? ' is-thinking' : ''}`}>{thinking && !hasActiveAssistant && workingTiming ? <ElapsedTime timing={workingTiming} fallback={task.createdAt} /> : null}{plan ? <PlanProgressIndicator plan={plan} /> : null}{contextCompactionStatus ? <ContextCompactionIndicator phase={contextCompactionStatus} /> : null}{statusText ? <div className="agent-status" aria-live="polite">{statusText}</div> : thinking ? <TypingIndicator /> : null}{trust ? <TrustCard request={trust} onDecision={onTrust} /> : null}</div></>;
}
