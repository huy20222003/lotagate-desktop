import type { Activity, FileChangeSummary } from '../../../contracts/ipc/v1/workspace.js';
import { CopyTextButton } from '../../components/ui.js';
import { formatTime } from '../../utils/time.js';
import { AgentMarkdown } from './markdown-renderer.js';
import { FileChangeCard } from './WorkspaceOverlays.js';
import { ElapsedTime, type TurnTiming } from './ElapsedTime.js';

export function AgentMessage({ activity, timing, fileChangeSummary, onOpenFileChanges }: { activity: Activity; timing?: TurnTiming | undefined; fileChangeSummary?: FileChangeSummary | undefined; onOpenFileChanges: (summary: FileChangeSummary) => void }) {
  return <article className="message agent-message"><div className="message-body"><ElapsedTime {...(timing === undefined ? {} : { timing })} fallback={activity.createdAt} /><AgentMarkdown content={activity.text} />{fileChangeSummary && fileChangeSummary.files.length > 0 ? <FileChangeCard summary={fileChangeSummary} onOpenFileChanges={onOpenFileChanges} /> : null}<div className="agent-message-meta"><CopyTextButton content={activity.text} label="Copy response" /><time dateTime={activity.createdAt}>{formatTime(activity.createdAt)}</time></div></div></article>;
}
