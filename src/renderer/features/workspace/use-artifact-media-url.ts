import { useEffect, useState } from 'react';
import type { Artifact } from '../../../contracts/ipc/v1/workspace.js';
import { artifactMediaBlob } from './source-view.js';

export function useArtifactMediaUrl(taskId: string, artifact: Artifact, enabled = true): { url?: string; error?: string } {
  const [url, setUrl] = useState<string>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    let cancelled = false;
    let ownedUrl: string | undefined;
    setUrl(undefined);
    setError(undefined);
    if (!enabled) return () => { cancelled = true; };
    const load = async () => {
      if (artifact.kind === 'image') {
        const preview = await window.lotagate.tasks.previewArtifact(taskId, artifact.id).catch(() => undefined);
        if (preview?.dataUrl !== undefined) {
          if (!cancelled) setUrl(preview.dataUrl);
          return;
        }
      }
      const media = await window.lotagate.tasks.readArtifactMedia(taskId, artifact.id);
      if (cancelled) return;
      ownedUrl = URL.createObjectURL(artifactMediaBlob(media.bytes, media.mimeType));
      setUrl(ownedUrl);
    };
    void load().catch(reason => { if (!cancelled) setError(reason instanceof Error ? reason.message : 'Unable to load media.'); });
    return () => { cancelled = true; if (ownedUrl !== undefined) URL.revokeObjectURL(ownedUrl); };
  }, [artifact.id, artifact.kind, enabled, taskId]);
  return { ...(url === undefined ? {} : { url }), ...(error === undefined ? {} : { error }) };
}
