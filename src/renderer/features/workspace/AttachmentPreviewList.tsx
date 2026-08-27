import { FileText, X } from 'lucide-react';
import type { AttachmentPreview } from './attachment-types.js';
import { Icon } from '../../components/ui.js';

export function AttachmentPreviewList({ attachments, onRemove, onOpenImage, className }: { attachments: readonly AttachmentPreview[]; onRemove?: (attachmentId: string) => Promise<void>; onOpenImage?: (attachment: AttachmentPreview) => void; className?: string }) {
  if (attachments.length === 0) return null;
  return <div className={`attachment-preview-list ${onRemove ? 'composer-attachment-list' : 'user-attachment-list'} ${className ?? ''}`} aria-label="Attached files">{attachments.map(attachment => attachment.kind === 'image' && attachment.dataUrl ? <div className="image-attachment-preview" key={attachment.id}><button type="button" className="image-attachment-open" onClick={() => onOpenImage?.(attachment)} aria-label={`Open image ${attachment.name}`}><img src={attachment.dataUrl} alt={attachment.name} /></button>{onRemove ? <button className="image-attachment-remove" aria-label={`Remove ${attachment.name}`} onClick={() => void onRemove(attachment.id)}><X size={13} /></button> : null}</div> : <div className="attachment-preview" key={attachment.id}><Icon icon={FileText} size={18} /><span title={attachment.name}>{attachment.name}</span>{onRemove ? <button className="attachment-remove" aria-label={`Remove ${attachment.name}`} onClick={() => void onRemove(attachment.id)}><X size={14} /></button> : null}</div>)}</div>;
}
