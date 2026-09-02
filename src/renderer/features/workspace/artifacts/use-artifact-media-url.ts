import { useEffect, useState } from 'react';
import type { Artifact } from '../../../../contracts/ipc/v1/workspace.js';
import { artifactMediaBlob } from './source-view.js';

export function useArtifactMediaUrl(taskId: string, artifact: Artifact, enabled = true): { url?: string; error?: string } {
  const media = useArtifactMediaUrls(taskId, enabled ? [artifact] : []);
  return media[artifact.id] ?? {};
}

export function useArtifactMediaUrls(taskId: string, artifacts: readonly Artifact[]): Record<string, { url?: string; error?: string }> {
  const [media, setMedia] = useState<Record<string, { url?: string; error?: string }>>({});
  const artifactKey = artifacts.map(artifact => `${artifact.id}:${artifact.kind}`).join('|');
  useEffect(() => {
    let cancelled = false;
    const ownedUrls = new Set<string>();
    setMedia({});
    for (const artifact of artifacts) {
      void loadArtifactMediaUrl(taskId, artifact).then(url => {
        if (cancelled) { if (url.startsWith('blob:')) URL.revokeObjectURL(url); return; }
        if (url.startsWith('blob:')) ownedUrls.add(url);
        setMedia(current => ({ ...current, [artifact.id]: { url } }));
      }).catch(reason => { if (!cancelled) setMedia(current => ({ ...current, [artifact.id]: { error: reason instanceof Error ? reason.message : 'Unable to load media.' } })); });
    }
    return () => { cancelled = true; for (const url of ownedUrls) URL.revokeObjectURL(url); };
  }, [artifactKey, taskId]);
  return media;
}

async function loadArtifactMediaUrl(taskId: string, artifact: Artifact): Promise<string> {
  if (artifact.kind === 'image') {
    const preview = await window.lotagate.tasks.previewArtifact(taskId, artifact.id);
    if (preview.dataUrl !== undefined) return preview.dataUrl;
  }
  const media = await window.lotagate.tasks.readArtifactMedia(taskId, artifact.id);
  return URL.createObjectURL(artifactMediaBlob(media.bytes, media.mimeType));
}
