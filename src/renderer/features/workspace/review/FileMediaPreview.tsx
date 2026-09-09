import type { Artifact } from '../../../../contracts/ipc/v1/workspace.js';
import { AudioWaveform } from '../artifacts/SourceAudioList.js';
import { artifactMediaBlob } from '../artifacts/source-view.js';
import type { OpenFileMedia } from './file-change-view.js';
import { fileName } from './file-change-view.js';
import { useEffect, useState } from 'react';

export function FileMediaPreview({ path, media }: { path: string; media: OpenFileMedia }) {
  const url = useMediaUrl(media);
  if (url === undefined) return <p className="file-content-media-state">Loading preview…</p>;
  if (media.kind === 'image') return <img className="file-content-media-image" src={url} alt={fileName(path)} />;
  if (media.kind === 'video') return <video className="file-content-media-video" src={url} controls playsInline preload="metadata" />;
  return <AudioWaveform taskId="file-content-preview" artifact={previewAudioArtifact(path)} sourceUrl={url} />;
}

function useMediaUrl(media: OpenFileMedia): string | undefined {
  const [url, setUrl] = useState<string | undefined>(media.dataUrl);
  useEffect(() => {
    if (media.dataUrl !== undefined) { setUrl(media.dataUrl); return; }
    if (media.bytes === undefined) { setUrl(undefined); return; }
    const objectUrl = URL.createObjectURL(artifactMediaBlob(media.bytes, media.mimeType));
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [media.bytes, media.dataUrl, media.mimeType]);
  return url;
}

function previewAudioArtifact(path: string): Artifact {
  return { id: `file-content:${path}`, taskId: 'file-content-preview', name: fileName(path), path, kind: 'audio', size: 0, createdAt: new Date(0).toISOString() };
}
