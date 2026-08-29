import type { Activity, Artifact, FileChangeSummary } from '../../../contracts/ipc/v1/workspace.js';
import type { AttachmentPreview } from './attachment-types.js';
import { AgentMessage } from './AgentMessage.js';
import { UserMessage } from './UserMessage.js';
import type { TurnTiming } from './ElapsedTime.js';

export function ChatMessage({ activity, attachments, artifacts, timing, fileChangeSummary, progressActivities, toolActivities, workspaceCwd, onOpenFileChanges, onOpenImage }: { activity: Activity; attachments: AttachmentPreview[]; artifacts: Artifact[]; timing?: TurnTiming | undefined; fileChangeSummary?: FileChangeSummary | undefined; progressActivities?: readonly Activity[]; toolActivities?: readonly Activity[]; workspaceCwd: string; onOpenFileChanges: (summary: FileChangeSummary) => void; onOpenImage: (attachment: AttachmentPreview) => void }) {
  if (activity.kind === 'user') return <UserMessage activity={activity} attachments={attachments} workspaceCwd={workspaceCwd} onOpenImage={onOpenImage} />;
  return <AgentMessage activity={activity} artifacts={artifacts} workspaceCwd={workspaceCwd} onOpenFileChanges={onOpenFileChanges} {...(timing === undefined ? {} : { timing })} {...(fileChangeSummary === undefined ? {} : { fileChangeSummary })} {...(progressActivities === undefined ? {} : { progressActivities })} {...(toolActivities === undefined ? {} : { toolActivities })} />;
}
