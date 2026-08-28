import { FileText, X } from 'lucide-react';
import type { AttachmentPreview } from './attachment-types.js';
import { Icon, IconButton } from '../../components/ui.js';
import { Scrollbar } from '../../components/Scrollbar.js';

export function AttachmentPreviewList({ attachments, onRemove, onOpenImage, className }: { attachments: readonly AttachmentPreview[]; onRemove?: (attachmentId: string) => Promise<void>; onOpenImage?: (attachment: AttachmentPreview) => void; className?: string }) {
  if (attachments.length === 0) return null;
  const inline = className === 'queued-attachment-list';
  return <Scrollbar axis="horizontal" className={`attachment-preview-scrollbar${inline ? ' is-inline' : ''}`}><div className={`attachment-preview-list ${onRemove ? 'composer-attachment-list' : 'user-attachment-list'} ${className ?? ''}`} aria-label="Attached files">{attachments.map(attachment => attachment.kind === 'image' && attachment.dataUrl ? <div className="image-attachment-preview" key={attachment.id}><button type="button" className="image-attachment-open" onClick={() => onOpenImage?.(attachment)} aria-label={`Open image ${attachment.name}`}><img src={attachment.dataUrl} alt={attachment.name} /></button>{onRemove ? <IconButton icon={X} iconSize={13} className="image-attachment-remove" label={`Remove ${attachment.name}`} onClick={() => void onRemove(attachment.id)} /> : null}</div> : <div className="attachment-preview" key={attachment.id}><Icon icon={FileText} size={18} /><span title={attachment.name}>{attachment.name}</span>{onRemove ? <IconButton icon={X} iconSize={14} className="attachment-remove" label={`Remove ${attachment.name}`} onClick={() => void onRemove(attachment.id)} /> : null}</div>)}</div></Scrollbar>;
}
