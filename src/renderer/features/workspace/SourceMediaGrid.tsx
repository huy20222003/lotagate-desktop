import { Film, Image as ImageIcon } from 'lucide-react';
import type { Artifact } from '../../../contracts/ipc/v1/workspace.js';
import { formatArtifactSize, type VisualArtifact } from './source-view.js';
import { useState } from 'react';
import { LightBox } from './LightBox.js';
import type { LightBoxMediaItem } from './lightbox-types.js';
import { useArtifactMediaUrls } from './use-artifact-media-url.js';
import { Icon } from '../../components/ui.js';

export function SourceMediaGrid({ taskId, artifacts, onDownload }: { taskId: string; artifacts: readonly VisualArtifact[]; onDownload: (artifact: Artifact) => void }) {
  if (artifacts.length === 0) return <p className="source-empty">No images or videos in this session.</p>;
  return <SourceMediaGallery taskId={taskId} artifacts={artifacts} onDownload={onDownload} />;
}

function SourceMediaGallery({ taskId, artifacts, onDownload }: { taskId: string; artifacts: readonly VisualArtifact[]; onDownload: (artifact: Artifact) => void }) {
  const mediaUrls = useArtifactMediaUrls(taskId, artifacts);
  const [lightBoxIndex, setLightBoxIndex] = useState<number>();
  const items = artifacts.flatMap<LightBoxMediaItem>(artifact => {
    const url = mediaUrls[artifact.id]?.url;
    if (url === undefined) return [];
    return [{ id: artifact.id, name: artifact.name, src: url, kind: artifact.kind, downloadName: artifact.name, onDownload: () => onDownload(artifact) }];
  });
  const itemIndexById = new Map(items.map((item, index) => [item.id, index]));
  return <><div className="source-media-grid">{artifacts.map(artifact => <SourceMediaTile key={artifact.id} artifact={artifact} mediaUrl={mediaUrls[artifact.id]?.url} onPreview={() => setLightBoxIndex(itemIndexById.get(artifact.id))} />)}</div>{lightBoxIndex !== undefined ? <LightBox items={items} initialIndex={lightBoxIndex} onClose={() => setLightBoxIndex(undefined)} /> : null}</>;
}

function SourceMediaTile({ artifact, mediaUrl, onPreview }: { artifact: VisualArtifact; mediaUrl: string | undefined; onPreview: () => void }) {
  return <article className="source-media-tile"><button type="button" className="source-media-open" onClick={onPreview} aria-label={`Open ${artifact.name}`}>
    {mediaUrl ? artifact.kind === 'video' ? <video src={mediaUrl} muted playsInline preload="metadata" /> : <img src={mediaUrl} alt="" /> : <span className="source-media-placeholder">{artifact.kind === 'video' ? <Icon icon={Film} size={30} /> : <Icon icon={ImageIcon} size={30} />}</span>}
    <span className="source-media-overlay"><strong>{artifact.name}</strong><small>{formatArtifactSize(artifact.size)}</small></span>
  </button></article>;
}
