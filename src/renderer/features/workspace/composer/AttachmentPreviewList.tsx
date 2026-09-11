import { useState } from 'react';
import { X } from 'lucide-react';
import type { AttachmentPreview } from '../../../services/attachment-types.js';
import { Icon, IconButton } from '../../../components/ui.js';
import { Scrollbar } from '../../../components/Scrollbar.js';
import { fileIconFor } from '../../../components/file-icon.js';
import { LightBox } from '../artifacts/LightBox.js';
import type { LightBoxMediaItem } from '../../../services/lightbox-types.js';
import { useAttachmentMediaUrls } from '../artifacts/use-attachment-media-urls.js';
import { openFilePath } from '../../../services/open-file.js';

export function AttachmentPreviewList({ taskId, attachments, onRemove, onOpen, className, inline = className === 'queued-attachment-list' }: { taskId?: string; attachments: readonly AttachmentPreview[]; onRemove?: (attachmentId: string) => Promise<void>; onOpen?: (attachment: AttachmentPreview) => void; className?: string; inline?: boolean }) {
  if (attachments.length === 0) return null;
  return <AttachmentPreviewContent {...(taskId === undefined ? {} : { taskId })} attachments={attachments} {...(onRemove === undefined ? {} : { onRemove })} {...(onOpen === undefined ? {} : { onOpen })} {...(className === undefined ? {} : { className })} inline={inline} />;
}

function AttachmentPreviewContent({ taskId, attachments, onRemove, onOpen, className, inline }: { taskId?: string; attachments: readonly AttachmentPreview[]; onRemove?: (attachmentId: string) => Promise<void>; onOpen?: (attachment: AttachmentPreview) => void; className?: string; inline: boolean }) {
  const mediaUrls = useAttachmentMediaUrls(taskId, attachments);
  const [lightBoxIndex, setLightBoxIndex] = useState<number>();
  const mediaItems = attachments.flatMap<LightBoxMediaItem>(attachment => {
    const url = mediaUrls[attachment.id];
    if ((attachment.kind !== 'image' && attachment.kind !== 'video') || url === undefined) return [];
    return [{ id: attachment.id, name: attachment.name, src: url, kind: attachment.kind, downloadName: attachment.name }];
  });
  const mediaIndexById = new Map(mediaItems.map((item, index) => [item.id, index]));
  const openAttachment = (attachment: AttachmentPreview): void => {
    if (!attachment.path) return;
    if (onOpen) { onOpen(attachment); return; }
    openFilePath(attachment.path, attachment.source === 'pasted-text' ? 'vscode' : undefined);
  };
  const hasPastedText = attachments.some(attachment => attachment.source === 'pasted-text');
  const previewList = <div className={`attachment-preview-list ${onRemove ? `composer-attachment-list${hasPastedText ? ' has-pasted-text' : ''}` : 'user-attachment-list'} ${className ?? ''}`} aria-label="Attached files">{attachments.map(attachment => {
    const url = mediaUrls[attachment.id];
    const isMedia = attachment.kind === 'image' || attachment.kind === 'video';
    if (isMedia && url !== undefined) return <div className="image-attachment-preview" key={attachment.id}><button type="button" className="image-attachment-open" onClick={() => setLightBoxIndex(mediaIndexById.get(attachment.id))} aria-label={`Open ${attachment.kind} ${attachment.name}`}>{attachment.kind === 'video' ? <video src={url} muted playsInline preload="metadata" /> : <img src={url} alt={attachment.name} />}</button>{onRemove ? <IconButton icon={X} iconSize={12} className="image-attachment-remove" label={`Remove ${attachment.name}`} tooltip={false} onClick={() => void onRemove(attachment.id)} /> : null}</div>;
    const title = attachment.source === 'pasted-text' ? (attachment.subtitle ?? attachment.name) : attachment.name;
    const subtitle = attachment.source === 'pasted-text' ? 'Pasted text' : attachment.kind;
    const content = <><Icon icon={fileIconFor(attachment)} size={18} /><span><strong title={attachment.name}>{title}</strong><small>{subtitle}</small></span></>;
    const canOpen = attachment.path !== undefined;
    return <div className="attachment-preview" key={attachment.id}>{canOpen ? <button type="button" className="attachment-preview-open" aria-label={`Open ${attachment.name}`} onClick={() => openAttachment(attachment)}>{content}</button> : content}{onRemove ? <IconButton icon={X} iconSize={12} className="attachment-remove" label={`Remove ${attachment.name}`} tooltip={false} onClick={() => void onRemove(attachment.id)} /> : null}</div>;
  })}</div>;
  return <>{inline ? <div className="attachment-preview-inline">{previewList}</div> : <Scrollbar axis="horizontal" className="attachment-preview-scrollbar">{previewList}</Scrollbar>}{lightBoxIndex !== undefined ? <LightBox items={mediaItems} initialIndex={lightBoxIndex} onClose={() => setLightBoxIndex(undefined)} /> : null}</>;
}
