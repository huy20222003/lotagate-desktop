import { memo } from 'react';
import type { Activity, Artifact, FileChangeSummary } from '../../../contracts/ipc/v1/workspace.js';
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
  progressActivities?: readonly Activity[];
  toolActivities?: readonly Activity[];
  workspaceCwd: string;
  onOpenFileChanges: (summary: FileChangeSummary) => void;
  onOpenImage: (attachment: AttachmentPreview) => void;
}

export const ChatMessage = memo(function ChatMessage({ activity, attachments, artifacts, timing, fileChangeSummary, progressActivities, toolActivities, workspaceCwd, onOpenFileChanges, onOpenImage }: ChatMessageProps) {
  if (activity.kind === 'user') return <UserMessage activity={activity} attachments={attachments} workspaceCwd={workspaceCwd} onOpenImage={onOpenImage} />;
  const streaming = timing?.endedAt === undefined && timing !== undefined;
  return <AgentMessage activity={activity} artifacts={artifacts} workspaceCwd={workspaceCwd} onOpenFileChanges={onOpenFileChanges} streaming={streaming} {...(timing === undefined ? {} : { timing })} {...(fileChangeSummary === undefined ? {} : { fileChangeSummary })} {...(progressActivities === undefined ? {} : { progressActivities })} {...(toolActivities === undefined ? {} : { toolActivities })} />;
}, areChatMessagePropsEqual);

function areChatMessagePropsEqual(previous: ChatMessageProps, next: ChatMessageProps): boolean {
  return previous.activity === next.activity
    && previous.attachments === next.attachments
    && previous.artifacts === next.artifacts
    && previous.fileChangeSummary === next.fileChangeSummary
    && previous.workspaceCwd === next.workspaceCwd
    && previous.onOpenFileChanges === next.onOpenFileChanges
    && previous.onOpenImage === next.onOpenImage
    && previous.timing?.startedAt === next.timing?.startedAt
    && previous.timing?.endedAt === next.timing?.endedAt
    && sameActivities(previous.progressActivities, next.progressActivities)
    && sameActivities(previous.toolActivities, next.toolActivities);
}

function sameActivities(previous: readonly Activity[] | undefined, next: readonly Activity[] | undefined): boolean {
  if (previous === next) return true;
  if (previous === undefined || next === undefined || previous.length !== next.length) return false;
  return previous.every((activity, index) => activity === next[index]);
}
