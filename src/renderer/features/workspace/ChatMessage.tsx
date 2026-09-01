import { memo } from 'react';
import type { Activity, Artifact, CheckpointUndoState, FileChangeSummary } from '../../../contracts/ipc/v1/workspace.js';
import type { AttachmentPreview } from './attachment-types.js';
import { AgentMessage } from './AgentMessage.js';
import { UserMessage } from './UserMessage.js';
import type { TurnTiming } from './ElapsedTime.js';

interface ChatMessageProps {
  activity: Activity;
  attachments: AttachmentPreview[];
  artifacts: Artifact[];
  timing?: TurnTiming | undefined;
  fileChangeSummary?: FileChangeSummary | undefined;
  undoState?: CheckpointUndoState | undefined;
  undoBusy?: boolean;
  activities?: readonly Activity[];
  workspaceCwd: string;
  onOpenFileChanges: (summary: FileChangeSummary) => void;
  onUndoFileChanges: (turnId: string) => Promise<void>;
}

export const ChatMessage = memo(function ChatMessage({ activity, attachments, artifacts, timing, fileChangeSummary, undoState, undoBusy, activities, workspaceCwd, onOpenFileChanges, onUndoFileChanges }: ChatMessageProps) {
  if (activity.kind === 'user') return <UserMessage activity={activity} attachments={attachments} workspaceCwd={workspaceCwd} />;
  const streaming = timing?.endedAt === undefined && timing !== undefined;
  return <AgentMessage activity={activity} artifacts={artifacts} workspaceCwd={workspaceCwd} onUndoFileChanges={onUndoFileChanges} {...(undoState === undefined ? {} : { undoState })} {...(undoBusy === undefined ? {} : { undoBusy })} onOpenFileChanges={onOpenFileChanges} streaming={streaming} {...(timing === undefined ? {} : { timing })} {...(fileChangeSummary === undefined ? {} : { fileChangeSummary })} {...(activities === undefined ? {} : { activities })} />;
}, areChatMessagePropsEqual);

function areChatMessagePropsEqual(previous: ChatMessageProps, next: ChatMessageProps): boolean {
  return previous.activity === next.activity
    && previous.attachments === next.attachments
    && previous.artifacts === next.artifacts
    && previous.fileChangeSummary === next.fileChangeSummary
    && previous.undoState === next.undoState
    && previous.undoBusy === next.undoBusy
    && previous.workspaceCwd === next.workspaceCwd
    && previous.onOpenFileChanges === next.onOpenFileChanges
    && previous.onUndoFileChanges === next.onUndoFileChanges
    && previous.timing?.startedAt === next.timing?.startedAt
    && previous.timing?.endedAt === next.timing?.endedAt
    && sameActivities(previous.activities, next.activities);
}

function sameActivities(previous: readonly Activity[] | undefined, next: readonly Activity[] | undefined): boolean {
  if (previous === next) return true;
  if (previous === undefined || next === undefined || previous.length !== next.length) return false;
  return previous.every((activity, index) => activity === next[index]);
}
