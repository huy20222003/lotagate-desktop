import { useState } from 'react';
import type { Activity } from '../../../../contracts/ipc/v1/workspace.js';
import { CopyTextButton } from '../../../components/ui.js';
import { formatTime } from '../../../utils/time.js';
import { formatTextClamp } from '../../../utils/text.js';
import type { AttachmentPreview } from '../../../services/attachment-types.js';
import { AttachmentPreviewList } from '../composer/AttachmentPreviewList.js';
import { MessageMarkup } from './message-markup.js';

export function UserMessage({ activity, attachments, workspaceCwd }: { activity: Activity; attachments: AttachmentPreview[]; workspaceCwd: string }) {
  const [expanded, setExpanded] = useState(false);
  const limit = 480;
  const collapsible = activity.text.length > limit;
  const text = !expanded ? formatTextClamp(limit, activity.text) : activity.text;
  const fileReferences = attachments.flatMap(attachment => attachment.path ? [{ path: attachment.path, name: attachment.name, kind: attachment.kind }] : []);
  return <article id={`chat-message-${activity.id}`} className="message user-message"><div className="message-body"><div className="user-message-content"><AttachmentPreviewList taskId={activity.taskId} attachments={attachments} inline /><div className="user-message-bubble"><div className="user-message-text"><MessageMarkup content={text} fileReferences={fileReferences} workspaceCwd={workspaceCwd} highlightPromptTokens /></div>{collapsible ? <button className="show-more" onClick={() => setExpanded(current => !current)}>{expanded ? 'Show less' : 'Show more'}</button> : null}</div></div><div className="user-message-meta"><time dateTime={activity.createdAt}>{formatTime(activity.createdAt)}</time><CopyTextButton content={activity.text} label="Copy message" /></div></div></article>;
}
