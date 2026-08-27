import { Download, Film, Image as ImageIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { Artifact } from '../../../contracts/ipc/v1/workspace.js';
import { Tooltip } from '../../components/ui.js';
import { formatArtifactSize } from './source-view.js';

export function SourceMediaGrid({ taskId, artifacts, onPreview, onDownload }: { taskId: string; artifacts: readonly Artifact[]; onPreview: (artifact: Artifact) => void; onDownload: (artifact: Artifact) => void }) {
  if (artifacts.length === 0) return <p className="source-empty">No images or videos in this session.</p>;
  return <div className="source-media-grid">{artifacts.map(artifact => <SourceMediaTile key={artifact.id} taskId={taskId} artifact={artifact} onPreview={onPreview} onDownload={onDownload} />)}</div>;
}

function SourceMediaTile({ taskId, artifact, onPreview, onDownload }: { taskId: string; artifact: Artifact; onPreview: (artifact: Artifact) => void; onDownload: (artifact: Artifact) => void }) {
  const [thumbnail, setThumbnail] = useState<string>();
  useEffect(() => {
    if (artifact.kind !== 'image') return;
    let cancelled = false;
    void window.lotagate.tasks.previewArtifact(taskId, artifact.id).then(preview => {
      if (!cancelled && preview.dataUrl !== undefined) setThumbnail(preview.dataUrl);
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [artifact.id, artifact.kind, taskId]);
  return <article className="source-media-tile"><button type="button" className="source-media-open" onClick={() => onPreview(artifact)} aria-label={`Open ${artifact.name}`}>
    {thumbnail ? <img src={thumbnail} alt="" /> : <span className="source-media-placeholder">{artifact.kind === 'video' ? <Film size={30} /> : <ImageIcon size={30} />}</span>}
    <span className="source-media-overlay"><strong>{artifact.name}</strong><small>{formatArtifactSize(artifact.size)}</small></span>
  </button><Tooltip label={`Download ${artifact.name}`}><button type="button" className="source-media-download" aria-label={`Download ${artifact.name}`} onClick={event => { event.stopPropagation(); onDownload(artifact); }}><Download size={14} /></button></Tooltip></article>;
}
