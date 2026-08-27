import { useState } from 'react';
import type { Activity } from '../../../contracts/ipc/v1/workspace.js';
import { CopyTextButton } from '../../components/ui.js';
import { formatTime } from '../../utils/time.js';
import { formatTextClamp } from '../../utils/text.js';
import type { AttachmentPreview } from './attachment-types.js';
import { AttachmentPreviewList } from './AttachmentPreviewList.js';
import { PromptMarkup } from './prompt-markup.js';

export function UserMessage({ activity, attachments, onOpenImage }: { activity: Activity; attachments: AttachmentPreview[]; onOpenImage: (attachment: AttachmentPreview) => void }) {
  const [expanded, setExpanded] = useState(false);
  const limit = 480;
  const collapsible = activity.text.length > limit;
  const text = !expanded ? formatTextClamp(limit, activity.text) : activity.text;
  return <article id={`chat-message-${activity.id}`} className="message user-message"><div className="message-body"><AttachmentPreviewList attachments={attachments} onOpenImage={onOpenImage} /><div className="user-message-bubble"><div className="user-message-text"><PromptMarkup content={text} /></div>{collapsible ? <button className="show-more" onClick={() => setExpanded(current => !current)}>{expanded ? 'Show less' : 'Show more'}</button> : null}</div><div className="user-message-meta"><time dateTime={activity.createdAt}>{formatTime(activity.createdAt)}</time><CopyTextButton content={activity.text} label="Copy message" /></div></div></article>;
}
