import { Film, Image as ImageIcon } from 'lucide-react';
import type { Artifact } from '../../../contracts/ipc/v1/workspace.js';
import { formatArtifactSize } from './source-view.js';
import { useArtifactMediaUrl } from './use-artifact-media-url.js';
import { Icon } from '../../components/ui.js';

export function SourceMediaGrid({ taskId, artifacts, onPreview }: { taskId: string; artifacts: readonly Artifact[]; onPreview: (artifact: Artifact) => void }) {
  if (artifacts.length === 0) return <p className="source-empty">No images or videos in this session.</p>;
  return <div className="source-media-grid">{artifacts.map(artifact => <SourceMediaTile key={artifact.id} taskId={taskId} artifact={artifact} onPreview={onPreview} />)}</div>;
}

function SourceMediaTile({ taskId, artifact, onPreview }: { taskId: string; artifact: Artifact; onPreview: (artifact: Artifact) => void }) {
  const { url: thumbnail } = useArtifactMediaUrl(taskId, artifact, artifact.kind === 'image');
  return <article className="source-media-tile"><button type="button" className="source-media-open" onClick={() => onPreview(artifact)} aria-label={`Open ${artifact.name}`}>
    {thumbnail ? <img src={thumbnail} alt="" /> : <span className="source-media-placeholder">{artifact.kind === 'video' ? <Icon icon={Film} size={30} /> : <Icon icon={ImageIcon} size={30} />}</span>}
    <span className="source-media-overlay"><strong>{artifact.name}</strong><small>{formatArtifactSize(artifact.size)}</small></span>
  </button></article>;
}
