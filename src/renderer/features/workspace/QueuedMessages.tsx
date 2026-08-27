import { CornerUpRight, Pencil, Trash2 } from 'lucide-react';
import { Tooltip } from '../../components/ui.js';
import { formatTextClamp } from '../../utils/text.js';
import type { AttachmentPreview } from './attachment-types.js';
import { AttachmentPreviewList } from './AttachmentPreviewList.js';
import type { QueuedMessage } from './message-queue-service.js';

export function QueuedMessages({ messages, onSteer, onRemove, onEdit, onOpenImage }: { messages: readonly QueuedMessage[]; onSteer: (id: string) => Promise<void>; onRemove: (id: string) => Promise<void>; onEdit: (id: string) => void; onOpenImage: (attachment: AttachmentPreview) => void }) {
  if (messages.length === 0) return null;
  return <div className="queued-messages" aria-label="Queued messages">{messages.map(message => <div className="queued-message" key={message.id}><div className="queued-message-content">{message.attachments.length > 0 ? <AttachmentPreviewList className="queued-attachment-list" attachments={message.attachments} onOpenImage={onOpenImage} /> : null}<span className="queued-message-text" title={message.prompt}>{formatTextClamp(180, message.prompt)}</span></div><div className="queued-message-actions"><Tooltip label="Steer"><button type="button" className="icon-button" aria-label="Steer queued message" onClick={() => void onSteer(message.id)}><CornerUpRight size={14} /></button></Tooltip><Tooltip label="Remove"><button type="button" className="icon-button" aria-label="Remove queued message" onClick={() => void onRemove(message.id)}><Trash2 size={14} /></button></Tooltip><Tooltip label="Edit"><button type="button" className="icon-button" aria-label="Edit queued message" onClick={() => onEdit(message.id)}><Pencil size={14} /></button></Tooltip></div></div>)}</div>;
}
