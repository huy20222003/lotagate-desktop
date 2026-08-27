import { Download, ExternalLink, FileText } from 'lucide-react';
import type { Artifact } from '../../../contracts/ipc/v1/workspace.js';
import { ActionMenu } from '../../components/ActionMenu.js';
import { artifactTypeLabel, formatArtifactSize, isInlinePreviewableArtifact } from './source-view.js';

export function SourceFileList({ artifacts, onOpen, onDownload }: { artifacts: readonly Artifact[]; onOpen: (artifact: Artifact) => void; onDownload: (artifact: Artifact) => void }) {
  if (artifacts.length === 0) return <p className="source-empty">No other files in this session.</p>;
  return <div className="source-file-list">{artifacts.map(artifact => <SourceFileRow key={artifact.id} artifact={artifact} onOpen={onOpen} onDownload={onDownload} />)}</div>;
}

function SourceFileRow({ artifact, onOpen, onDownload }: { artifact: Artifact; onOpen: (artifact: Artifact) => void; onDownload: (artifact: Artifact) => void }) {
  const previewable = isInlinePreviewableArtifact(artifact);
  return <article className="source-file-row"><button type="button" className="source-file-open" onClick={() => onOpen(artifact)}><FileText size={17} /><span><strong title={artifact.name}>{artifact.name}</strong><small>{artifactTypeLabel(artifact)} · {formatArtifactSize(artifact.size)}</small></span></button><ActionMenu ariaLabel={`Actions for ${artifact.name}`} items={[{ label: previewable ? 'Preview' : 'Open externally', icon: ExternalLink, onSelect: () => onOpen(artifact) }, { label: 'Download', icon: Download, onSelect: () => onDownload(artifact) }]} /></article>;
}
