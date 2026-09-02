import { useState } from 'react';
import { X } from 'lucide-react';
import type { AttachmentPreview } from '../../../services/attachment-types.js';
import { Icon, IconButton } from '../../../components/ui.js';
import { Scrollbar } from '../../../components/Scrollbar.js';
import { fileIconFor } from '../../../components/file-icon.js';
import { LightBox } from '../artifacts/LightBox.js';
import type { LightBoxMediaItem } from '../../../services/lightbox-types.js';
import { useAttachmentMediaUrls } from '../artifacts/use-attachment-media-urls.js';

export function AttachmentPreviewList({ taskId, attachments, onRemove, className }: { taskId?: string; attachments: readonly AttachmentPreview[]; onRemove?: (attachmentId: string) => Promise<void>; className?: string }) {
  if (attachments.length === 0) return null;
  const inline = className === 'queued-attachment-list';
  return <AttachmentPreviewContent {...(taskId === undefined ? {} : { taskId })} attachments={attachments} {...(onRemove === undefined ? {} : { onRemove })} {...(className === undefined ? {} : { className })} inline={inline} />;
}

function AttachmentPreviewContent({ taskId, attachments, onRemove, className, inline }: { taskId?: string; attachments: readonly AttachmentPreview[]; onRemove?: (attachmentId: string) => Promise<void>; className?: string; inline: boolean }) {
  const mediaUrls = useAttachmentMediaUrls(taskId, attachments);
  const [lightBoxIndex, setLightBoxIndex] = useState<number>();
  const mediaItems = attachments.flatMap<LightBoxMediaItem>(attachment => {
    const url = mediaUrls[attachment.id];
    if ((attachment.kind !== 'image' && attachment.kind !== 'video') || url === undefined) return [];
    return [{ id: attachment.id, name: attachment.name, src: url, kind: attachment.kind, downloadName: attachment.name }];
  });
  const mediaIndexById = new Map(mediaItems.map((item, index) => [item.id, index]));
  return <><Scrollbar axis="horizontal" className={`attachment-preview-scrollbar${inline ? ' is-inline' : ''}`}><div className={`attachment-preview-list ${onRemove ? 'composer-attachment-list' : 'user-attachment-list'} ${className ?? ''}`} aria-label="Attached files">{attachments.map(attachment => {
    const url = mediaUrls[attachment.id];
    const isMedia = attachment.kind === 'image' || attachment.kind === 'video';
    if (isMedia && url !== undefined) return <div className="image-attachment-preview" key={attachment.id}><button type="button" className="image-attachment-open" onClick={() => setLightBoxIndex(mediaIndexById.get(attachment.id))} aria-label={`Open ${attachment.kind} ${attachment.name}`}>{attachment.kind === 'video' ? <video src={url} muted playsInline preload="metadata" /> : <img src={url} alt={attachment.name} />}</button>{onRemove ? <IconButton icon={X} iconSize={13} className="image-attachment-remove" label={`Remove ${attachment.name}`} onClick={() => void onRemove(attachment.id)} /> : null}</div>;
    return <div className="attachment-preview" key={attachment.id}><Icon icon={fileIconFor(attachment)} size={18} /><span title={attachment.name}>{attachment.name}</span>{onRemove ? <IconButton icon={X} iconSize={14} className="attachment-remove" label={`Remove ${attachment.name}`} onClick={() => void onRemove(attachment.id)} /> : null}</div>;
  })}</div></Scrollbar>{lightBoxIndex !== undefined ? <LightBox items={mediaItems} initialIndex={lightBoxIndex} onClose={() => setLightBoxIndex(undefined)} /> : null}</>;
}
