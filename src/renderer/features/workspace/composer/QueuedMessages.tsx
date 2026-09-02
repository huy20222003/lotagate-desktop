import { CornerUpRight, Pencil, Trash2 } from 'lucide-react';
import { IconButton } from '../../../components/ui.js';
import { formatTextClamp } from '../../../utils/text.js';
import { AttachmentPreviewList } from './AttachmentPreviewList.js';
import type { QueuedMessage } from '../state/message-queue-service.js';

export function QueuedMessages({ taskId, messages, onSteer, onRemove, onEdit }: { taskId?: string; messages: readonly QueuedMessage[]; onSteer: (id: string) => Promise<void>; onRemove: (id: string) => Promise<void>; onEdit: (id: string) => void }) {
  if (messages.length === 0) return null;
  return <div className="queued-messages" aria-label="Queued messages">{messages.map(message => <div className="queued-message" key={message.id}><div className="queued-message-content">{message.attachments.length > 0 ? <AttachmentPreviewList {...(taskId === undefined ? {} : { taskId })} className="queued-attachment-list" attachments={message.attachments} /> : null}<span className="queued-message-text" title={message.prompt}>{formatTextClamp(180, message.prompt)}</span></div><div className="queued-message-actions"><IconButton icon={CornerUpRight} iconSize={14} label="Steer queued message" onClick={() => void onSteer(message.id)} /><IconButton icon={Trash2} iconSize={14} label="Remove queued message" onClick={() => void onRemove(message.id)} /><IconButton icon={Pencil} iconSize={14} label="Edit queued message" onClick={() => onEdit(message.id)} /></div></div>)}</div>;
}
