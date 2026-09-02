import { useEffect, useState } from 'react';
import type { AttachmentPreview } from '../../../services/attachment-types.js';
import { artifactMediaBlob } from './source-view.js';

export function useAttachmentMediaUrls(taskId: string | undefined, attachments: readonly AttachmentPreview[]): Record<string, string> {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const mediaAttachments = attachments.filter(attachment => attachment.kind === 'image' || attachment.kind === 'video');
  const attachmentKey = mediaAttachments.map(attachment => `${attachment.id}:${attachment.dataUrl ?? ''}`).join('|');
  useEffect(() => {
    let cancelled = false;
    const ownedUrls = new Set<string>();
    setUrls(Object.fromEntries(mediaAttachments.flatMap(attachment => attachment.dataUrl === undefined ? [] : [[attachment.id, attachment.dataUrl] as const])));
    if (taskId === undefined) return () => { cancelled = true; };
    for (const attachment of mediaAttachments) {
      if (attachment.dataUrl !== undefined) continue;
      void window.lotagate.tasks.readArtifactMedia(taskId, attachment.id).then(media => {
        const url = URL.createObjectURL(artifactMediaBlob(media.bytes, media.mimeType));
        if (cancelled) { URL.revokeObjectURL(url); return; }
        ownedUrls.add(url);
        setUrls(current => ({ ...current, [attachment.id]: url }));
      }).catch(() => undefined);
    }
    return () => { cancelled = true; for (const url of ownedUrls) URL.revokeObjectURL(url); };
  }, [attachmentKey, taskId]);
  return urls;
}
