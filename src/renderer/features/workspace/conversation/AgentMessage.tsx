import type { Activity, Artifact, CheckpointUndoState, FileChangeSummary } from '../../../../contracts/ipc/v1/workspace.js';
import { CopyTextButton } from '../../../components/ui.js';
import { formatMessageTime } from '../../../utils/time.js';
import { AgentMarkdown } from './markdown-renderer.js';
import { FileChangeCard } from '../shell/WorkspaceOverlays.js';
import { ElapsedTime, type TurnTiming } from './ElapsedTime.js';
import { AgentMediaResponse } from '../artifacts/AgentMediaResponse.js';
import { AgentFileResponse } from '../artifacts/AgentFileResponse.js';
import { readMediaPaths } from '../state/workspace-controller-helpers.js';
import { resolveWorkspacePath, type MessageFileReference } from './message-markup.js';
import { useSmoothStreamingText } from './use-smooth-streaming-text.js';
import type { OpenFileChangesHandler } from '../review/file-change-view.js';

export function AgentMessage({ activity, artifacts, timing, streaming = false, fileChangeSummary, undoState, undoBusy = false, activities = [], workspaceCwd, onUndoFileChanges, onOpenFileChanges }: { activity: Activity; artifacts: Artifact[]; timing?: TurnTiming | undefined; streaming?: boolean; fileChangeSummary?: FileChangeSummary | undefined; undoState?: CheckpointUndoState | undefined; undoBusy?: boolean; activities?: readonly Activity[]; workspaceCwd: string; onUndoFileChanges: (turnId: string) => Promise<void>; onOpenFileChanges: OpenFileChangesHandler }) {
  const displayedText = useSmoothStreamingText(activity.text, streaming);
  const fileReferences: MessageFileReference[] = [...artifacts.map(artifact => ({ path: artifact.path, name: artifact.name, kind: artifact.kind })), ...(fileChangeSummary?.files ?? []).map(change => ({ path: resolveWorkspacePath(change.path, workspaceCwd), name: change.path.split(/[\\/]/u).pop() ?? change.path })), ...readMediaPaths(activity.metadata['mediaPaths'], activity.text).map(path => ({ path }))];
  const executionCwd = typeof activity.metadata['executionCwd'] === 'string' ? activity.metadata['executionCwd'] : undefined;
  const turnId = typeof activity.metadata['turnId'] === 'string' ? activity.metadata['turnId'] : undefined;
  return <article className="message agent-message"><div className="message-body"><ElapsedTime {...(timing === undefined ? {} : { timing })} fallback={activity.createdAt} activities={activities} /><AgentMarkdown content={displayedText} fileReferences={fileReferences} workspaceCwd={workspaceCwd} {...(executionCwd === undefined ? {} : { executionCwd })} />{artifacts.length > 0 ? <AgentMediaResponse taskId={activity.taskId} artifacts={artifacts} /> : null}<AgentFileResponse taskId={activity.taskId} artifacts={artifacts} />{fileChangeSummary && fileChangeSummary.files.length > 0 ? <FileChangeCard summary={fileChangeSummary} undoBusy={undoBusy} {...(undoState === undefined ? {} : { undoState })} {...(turnId === undefined ? {} : { onUndo: () => onUndoFileChanges(turnId) })} onOpenFileChanges={onOpenFileChanges} /> : null}<div className="agent-message-meta"><CopyTextButton content={activity.text} label="Copy response" /><time dateTime={activity.createdAt}>{formatMessageTime(activity.createdAt)}</time></div></div></article>;
}
