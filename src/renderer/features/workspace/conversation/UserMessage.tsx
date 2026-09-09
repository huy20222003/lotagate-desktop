import { useState } from 'react';
import type { Activity } from '../../../../contracts/ipc/v1/workspace.js';
import { CopyTextButton } from '../../../components/ui.js';
import { formatMessageTime } from '../../../utils/time.js';
import { formatTextClamp } from '../../../utils/text.js';
import type { AttachmentPreview } from '../../../services/attachment-types.js';
import { AttachmentPreviewList } from '../composer/AttachmentPreviewList.js';
import { MessageMarkup } from './message-markup.js';
import { openFilePath } from '../../../services/open-file.js';
import type { OpenFileTargetHandler } from '../review/file-change-view.js';

export function UserMessage({ activity, attachments, workspaceCwd, onOpenAttachment = () => undefined }: { activity: Activity; attachments: AttachmentPreview[]; workspaceCwd: string; onOpenAttachment?: OpenFileTargetHandler }) {
  const [expanded, setExpanded] = useState(false);
  const limit = 480;
  const collapsible = activity.text.length > limit;
  const text = !expanded ? formatTextClamp(limit, activity.text) : activity.text;
  const fileReferences = attachments.flatMap(attachment => attachment.path ? [{ path: attachment.path, name: attachment.name, kind: attachment.kind }] : []);
  const handleOpenAttachment = (attachment: AttachmentPreview) => {
    if (attachment.path === undefined) return;
    if (attachment.source === 'pasted-text') onOpenAttachment({ path: attachment.path, artifact: { taskId: activity.taskId, artifactId: attachment.id } });
    else openFilePath(attachment.path);
  };
  return <article id={`chat-message-${activity.id}`} className="message user-message"><div className="message-body"><div className="user-message-content"><AttachmentPreviewList taskId={activity.taskId} attachments={attachments} onOpen={handleOpenAttachment} inline /><div className="user-message-bubble"><div className="user-message-text"><MessageMarkup content={text} fileReferences={fileReferences} workspaceCwd={workspaceCwd} highlightPromptTokens /></div>{collapsible ? <button className="show-more" onClick={() => setExpanded(current => !current)}>{expanded ? 'Show less' : 'Show more'}</button> : null}</div></div><div className="user-message-meta"><time dateTime={activity.createdAt}>{formatMessageTime(activity.createdAt)}</time><CopyTextButton content={activity.text} label="Copy message" /></div></div></article>;
}
