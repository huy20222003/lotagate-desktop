import { Download, X } from 'lucide-react';
import type { Artifact } from '../../../../contracts/ipc/v1/workspace.js';
import { IconButton, OverlayDialog, Skeleton } from '../../../components/ui.js';
import { AudioWaveform } from './SourceAudioList.js';
import { ArtifactContentViewer } from './ArtifactContentViewer.js';

export function SourcePreviewDialog({ taskId, artifact, mediaUrl, content, onDownload, onClose }: { taskId: string; artifact: Artifact; mediaUrl?: string; content?: string; onDownload: (artifact: Artifact) => void; onClose: () => void }) {
  return <OverlayDialog label={artifact.name} onClose={onClose} className="source-preview-dialog" overlayClassName="source-preview-backdrop"><header className="source-preview-header"><div><strong title={artifact.name}>{artifact.name}</strong><small>{artifact.kind}</small></div><div className="source-preview-actions"><IconButton icon={Download} iconSize={18} className="source-preview-action" label={`Download ${artifact.name}`} onClick={() => onDownload(artifact)} /><IconButton icon={X} iconSize={20} className="source-preview-action" label="Close preview" onClick={onClose} /></div></header><div className="source-preview-body">{artifact.kind === 'audio' ? <AudioWaveform taskId={taskId} artifact={artifact} {...(mediaUrl === undefined ? {} : { sourceUrl: mediaUrl })} onDownload={onDownload} /> : null}{content !== undefined ? <ArtifactContentViewer artifact={artifact} content={content} /> : null}{mediaUrl === undefined && content === undefined && artifact.kind !== 'audio' ? <Skeleton className="source-preview-skeleton" aria-label="Loading preview" /> : null}</div></OverlayDialog>;
}
