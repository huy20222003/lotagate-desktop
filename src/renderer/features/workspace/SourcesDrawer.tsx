import { useCallback, useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import type { Artifact } from '../../../contracts/ipc/v1/workspace.js';
import { IconButton, Tabs } from '../../components/ui.js';
import { Scrollbar } from '../../components/Scrollbar.js';
import { ImageLightbox } from './ImageLightbox.js';
import { SourceAudioList } from './SourceAudioList.js';
import { SourceFileList } from './SourceFileList.js';
import { SourceMediaGrid } from './SourceMediaGrid.js';
import { SourcePreviewDialog } from './SourcePreviewDialog.js';
import { SOURCE_TABS, artifactMediaBlob, audioArtifacts, fileArtifacts, mediaArtifacts, type SourceTab } from './source-view.js';
import { useResizableSidePanel } from './use-resizable-panel.js';

type PreviewState = { artifact: Artifact; mediaUrl?: string; content?: string };

export function SourcesDrawer({ taskId, refreshKey, onClose }: { taskId: string; refreshKey?: string; onClose: () => void }) {
  const [activeTab, setActiveTab] = useState<SourceTab>('media');
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [preview, setPreview] = useState<PreviewState>();
  const { panelWidth, resizing, startResize, handleResizeKeyDown } = useResizableSidePanel();
  const previewUrlRef = useRef<string>();
  const requestRef = useRef(0);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(undefined);
    void window.lotagate.tasks.artifacts(taskId).then(next => { if (!cancelled) setArtifacts(next); }).catch(reason => { if (!cancelled) setError(reason instanceof Error ? reason.message : 'Unable to load sources.'); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [refreshKey, taskId]);
  useEffect(() => () => { if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current); }, []);
  const clearPreview = useCallback(() => { if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current); previewUrlRef.current = undefined; setPreview(undefined); }, []);
  const openMedia = useCallback(async (artifact: Artifact) => {
    const request = ++requestRef.current;
    clearPreview();
    try {
      if (artifact.kind === 'image') {
        const preview = await window.lotagate.tasks.previewArtifact(taskId, artifact.id);
        if (request !== requestRef.current) return;
        if (preview.dataUrl !== undefined) {
          setPreview({ artifact, mediaUrl: preview.dataUrl });
          return;
        }
      }
      const media = await window.lotagate.tasks.readArtifactMedia(taskId, artifact.id);
      if (request !== requestRef.current) return;
      const url = URL.createObjectURL(artifactMediaBlob(media.bytes, media.mimeType));
      previewUrlRef.current = url;
      setPreview({ artifact, mediaUrl: url });
    } catch (reason) { if (request === requestRef.current) setError(reason instanceof Error ? reason.message : 'Unable to open media.'); }
  }, [clearPreview, taskId]);
  const openFile = useCallback(async (artifact: Artifact) => {
    const request = ++requestRef.current;
    clearPreview();
    try {
      const result = await window.lotagate.tasks.previewArtifact(taskId, artifact.id);
      if (request !== requestRef.current) return;
      if (result.content !== undefined) setPreview({ artifact, content: result.content });
      else await window.lotagate.tasks.openArtifact(taskId, artifact.id);
    } catch (reason) { if (request === requestRef.current) setError(reason instanceof Error ? reason.message : 'Unable to open file.'); }
  }, [clearPreview, taskId]);
  const download = useCallback(async (artifact: Artifact) => { try { await window.lotagate.tasks.downloadArtifact(taskId, artifact.id); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to download file.'); } }, [taskId]);
  const currentArtifacts = activeTab === 'media' ? mediaArtifacts(artifacts) : activeTab === 'audio' ? audioArtifacts(artifacts) : fileArtifacts(artifacts);
  const tabContent = activeTab === 'media' ? <SourceMediaGrid taskId={taskId} artifacts={currentArtifacts} onPreview={artifact => void openMedia(artifact)} /> : activeTab === 'audio' ? <SourceAudioList taskId={taskId} artifacts={currentArtifacts} onPreview={artifact => void openMedia(artifact)} onDownload={artifact => void download(artifact)} /> : <SourceFileList artifacts={currentArtifacts} onOpen={artifact => void openFile(artifact)} onDownload={artifact => void download(artifact)} />;
  return <aside className={`file-changes-panel source-panel${resizing ? ' is-resizing' : ''}`} style={{ width: `${panelWidth}px` }} aria-label="Session sources"><div className="file-changes-resize-handle" role="separator" aria-label="Resize sources panel" aria-orientation="vertical" tabIndex={0} onPointerDown={startResize} onKeyDown={handleResizeKeyDown} /><header className="file-changes-panel-header"><div className="file-changes-tab-strip"><Tabs value={activeTab} items={SOURCE_TABS} onChange={value => setActiveTab(value as SourceTab)} ariaLabel="Source types" /></div><IconButton icon={X} iconSize={16} label="Close sources" onClick={onClose} /></header><div className="file-changes-summary"><strong>Sources</strong><span>{currentArtifacts.length} {currentArtifacts.length === 1 ? 'file' : 'files'}</span></div>{error ? <p className="source-error">{error}</p> : null}{loading ? <p className="source-empty">Loading sources…</p> : <Scrollbar className="source-list">{tabContent}</Scrollbar>}{preview?.artifact.kind === 'image' && preview.mediaUrl ? <ImageLightbox src={preview.mediaUrl} alt={preview.artifact.name} downloadName={preview.artifact.name} onClose={clearPreview} /> : preview && (preview.artifact.kind === 'video' || preview.artifact.kind === 'audio' || preview.content !== undefined) ? <SourcePreviewDialog taskId={taskId} artifact={preview.artifact} {...(preview.mediaUrl === undefined ? {} : { mediaUrl: preview.mediaUrl })} {...(preview.content === undefined ? {} : { content: preview.content })} onDownload={artifact => void download(artifact)} onClose={clearPreview} /> : null}</aside>;
}
