import { Download, ExternalLink } from 'lucide-react';
import { Icon, IconButton } from '../../../components/ui.js';
import type { Artifact } from '../../../../contracts/ipc/v1/workspace.js';
import { ActionMenu } from '../../../components/ActionMenu.js';
import { artifactTypeLabel, formatArtifactSize, isInlinePreviewableArtifact } from './source-view.js';
import { fileIconFor } from '../../../components/file-icon.js';

export function SourceFileList({ artifacts, onOpen, onDownload }: { artifacts: readonly Artifact[]; onOpen: (artifact: Artifact) => void; onDownload: (artifact: Artifact) => void }) {
  return <ArtifactFileList artifacts={artifacts} onOpen={onOpen} onDownload={onDownload} emptyMessage="No other files in this session." />;
}

export function ArtifactFileList({ artifacts, onOpen, onDownload, variant = 'source', emptyMessage = 'No files were created.' }: { artifacts: readonly Artifact[]; onOpen: (artifact: Artifact) => void; onDownload: (artifact: Artifact) => void; variant?: 'source' | 'response'; emptyMessage?: string }) {
  if (artifacts.length === 0) return <p className="source-empty">{emptyMessage}</p>;
  return <div className="source-file-list">{artifacts.map(artifact => <ArtifactFileRow key={artifact.id} artifact={artifact} onOpen={onOpen} onDownload={onDownload} variant={variant} />)}</div>;
}

function ArtifactFileRow({ artifact, onOpen, onDownload, variant }: { artifact: Artifact; onOpen: (artifact: Artifact) => void; onDownload: (artifact: Artifact) => void; variant: 'source' | 'response' }) {
  const previewable = isInlinePreviewableArtifact(artifact);
  return <article className={`source-file-row${variant === 'response' ? ' agent-file-row' : ''}`}><button type="button" className="source-file-open" onClick={() => onOpen(artifact)}><Icon icon={fileIconFor(artifact)} size={17} /><span><strong title={artifact.name}>{artifact.name}</strong><small>{artifactTypeLabel(artifact)} · {formatArtifactSize(artifact.size)}</small></span></button>{variant === 'source' ? <ActionMenu ariaLabel={`Actions for ${artifact.name}`} items={[{ label: previewable ? 'Preview' : 'Open externally', icon: ExternalLink, onSelect: () => onOpen(artifact) }, { label: 'Download', icon: Download, onSelect: () => onDownload(artifact) }]} /> : <IconButton icon={Download} iconSize={16} label={`Download ${artifact.name}`} tooltip={`Download ${artifact.name}`} onClick={() => onDownload(artifact)} />}</article>;
}
