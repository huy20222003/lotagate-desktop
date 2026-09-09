import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Columns2, List, Maximize2, Minimize2, X } from 'lucide-react';
import type { FileChangeSummary } from '../../../../contracts/ipc/v1/workspace.js';
import { IconButton, Tabs } from '../../../components/ui.js';
import { Scrollbar } from '../../../components/Scrollbar.js';
import { toUserErrorMessage as toMessage } from '../../../utils/errors.js';
import { FileChangeItem } from './FileChangeItem.js';
import { FileContentTab } from './FileContentTab.js';
import { absoluteWorkspacePath, fileName, filePathFromTab, fileTabValue, REVIEW_TAB, type DiffViewMode, type OpenFileState, type OpenFileTarget } from './file-change-view.js';
import { useResizableSidePanel } from '../state/use-resizable-panel.js';
import { openFilePath } from '../../../services/open-file.js';
import type { DesktopFilePreview } from '../../../../contracts/ipc/v1/workspace.js';
import { fileIconFor } from '../../../components/file-icon.js';

export function FileChangesDrawer({ cwd, summary, initialExpandedPath, initialFile, onClose }: { cwd: string; summary: FileChangeSummary; initialExpandedPath?: string; initialFile?: OpenFileTarget; onClose: () => void }) {
  const { panelWidth, resizing, startResize, handleResizeKeyDown } = useResizableSidePanel();
  const [activeTab, setActiveTab] = useState(REVIEW_TAB);
  const [openFiles, setOpenFiles] = useState<Record<string, OpenFileState>>({});
  const [viewMode, setViewMode] = useState<DiffViewMode>('unified');
  const [expanded, setExpanded] = useState(false);
  const initialFileKey = initialFile === undefined ? undefined : `${initialFile.path}:${initialFile.artifact?.taskId ?? ''}:${initialFile.artifact?.artifactId ?? ''}`;
  const openedInitialFileRef = useRef<{ key: string; target: OpenFileTarget }>();
  const pendingTabRef = useRef<string>();
  const nextViewMode: DiffViewMode = viewMode === 'unified' ? 'split' : 'unified';
  const nextViewLabel = nextViewMode === 'split' ? 'Side-by-side diff' : 'Unified diff';
  const NextViewIcon = nextViewMode === 'split' ? Columns2 : List;
  const ExpandIcon = expanded ? Minimize2 : Maximize2;
  const expandLabel = expanded ? 'Collapse changed files' : 'Expand changed files';
  const tabItems = useMemo(() => [{ value: REVIEW_TAB, label: 'Review', icon: fileIconFor({ name: 'review.diff', kind: 'patch' }) }, ...Object.keys(openFiles).map(path => ({ value: fileTabValue(path), label: fileName(path), icon: fileIconFor({ name: path }) }))], [openFiles]);
  useEffect(() => { setActiveTab(current => { const path = filePathFromTab(current); return current === REVIEW_TAB || (path !== undefined && openFiles[path] !== undefined) ? current : REVIEW_TAB; }); }, [openFiles]);
  const openFile = useCallback(async (target: OpenFileTarget) => {
    const tab = fileTabValue(target.path);
    pendingTabRef.current = tab;
    setActiveTab(tab);
    if (openFiles[target.path] !== undefined) { pendingTabRef.current = undefined; return; }
    setOpenFiles(current => ({ ...current, [target.path]: { status: 'loading' } }));
    try {
      const file = target.artifact === undefined
        ? (/^(?:[A-Za-z]:[\\/]|\\\\|\/(?!\/))/u.test(target.path) ? await window.lotagate.operations.previewFile(target.path) : { kind: 'text' as const, content: await window.lotagate.git.readFile(cwd, target.path) })
        : await previewArtifactFile(target.artifact.taskId, target.artifact.artifactId);
      setOpenFiles(current => ({ ...current, [target.path]: 'status' in file ? file : toOpenFileState(file) }));
    } catch (reason) { setOpenFiles(current => ({ ...current, [target.path]: { status: 'error', error: toMessage(reason) } })); }
  }, [cwd, openFiles]);
  useEffect(() => {
    const pending = pendingTabRef.current;
    const path = pending === undefined ? undefined : filePathFromTab(pending);
    if (pending === undefined || path === undefined || openFiles[path] === undefined) return;
    pendingTabRef.current = undefined;
    setActiveTab(pending);
  }, [openFiles]);
  useEffect(() => {
    if (initialFile === undefined) {
      pendingTabRef.current = undefined;
      setActiveTab(REVIEW_TAB);
    }
  }, [initialFile]);
  useEffect(() => {
    const opened = openedInitialFileRef.current;
    if (initialFile === undefined || initialFileKey === undefined || (opened?.key === initialFileKey && opened.target === initialFile)) return;
    openedInitialFileRef.current = { key: initialFileKey, target: initialFile };
    void openFile(initialFile);
  }, [initialFile, initialFileKey, openFile]);
  const closeFile = useCallback((value: string) => { const path = filePathFromTab(value); if (path === undefined) return; setOpenFiles(current => { const next = { ...current }; delete next[path]; return next; }); setActiveTab(current => current === value ? REVIEW_TAB : current); }, []);
  const activePath = filePathFromTab(activeTab);
  const activeFile = activePath === undefined ? undefined : openFiles[activePath];
  const selectedPathExists = initialExpandedPath !== undefined && summary.files.some(change => change.path === initialExpandedPath);
  return <aside className={`file-changes-panel${resizing ? ' is-resizing' : ''}${expanded ? ' is-expanded' : ''}`} {...(expanded ? {} : { style: { width: `${panelWidth}px` } })} aria-label="Changed files"><div className="file-changes-resize-handle" role="separator" aria-label="Resize changed files panel" aria-orientation="vertical" tabIndex={0} onPointerDown={startResize} onKeyDown={handleResizeKeyDown} /><header className="file-changes-panel-header"><div className="file-changes-tab-strip"><Tabs value={activeTab} items={tabItems} onChange={setActiveTab} onClose={closeFile} closeActiveOnly ariaLabel="Changed file views" /></div><div className="file-changes-header-actions"><IconButton icon={NextViewIcon} iconSize={16} label={nextViewLabel} onClick={() => setViewMode(nextViewMode)} /><IconButton icon={ExpandIcon} iconSize={16} label={expandLabel} onClick={() => setExpanded(current => !current)} /><IconButton icon={X} iconSize={16} label="Close changed files" onClick={onClose} /></div></header><div className="file-changes-summary"><strong>Last Turn</strong><span className="change-additions">+{summary.additions}</span><span className="change-deletions">-{summary.deletions}</span></div>{activeTab === REVIEW_TAB ? <Scrollbar className="file-changes-list"><div className="file-review-list">{summary.files.length === 0 ? <p className="file-changes-empty">No changed files in this turn.</p> : summary.files.map(change => <FileChangeItem key={`${change.path}:${initialExpandedPath ?? 'all'}`} change={change} workspaceCwd={cwd} initiallyExpanded={initialExpandedPath === undefined || !selectedPathExists || change.path === initialExpandedPath} viewMode={viewMode} showActions onOpenFilePath={() => openFilePath(absoluteWorkspacePath(cwd, change.path))} onOpenFile={() => void openFile({ path: change.path })} />)}</div></Scrollbar> : <FileContentTab cwd={cwd} path={activePath ?? ''} {...(activeFile === undefined ? {} : { file: activeFile })} onOpenPath={path => void openFile({ path })} />}</aside>;
}

async function previewArtifactFile(taskId: string, artifactId: string): Promise<OpenFileState> {
  const preview = await window.lotagate.tasks.previewArtifact(taskId, artifactId);
  if (preview.artifact.kind !== 'image' && preview.artifact.kind !== 'audio' && preview.artifact.kind !== 'video') return { status: 'ready', content: preview.content ?? '' };
  if (preview.artifact.kind === 'image' && preview.dataUrl !== undefined) {
    return { status: 'ready', media: { kind: 'image', mimeType: preview.dataUrl.slice(5, preview.dataUrl.indexOf(';')), dataUrl: preview.dataUrl } };
  }
  const media = await window.lotagate.tasks.readArtifactMedia(taskId, artifactId);
  return { status: 'ready', media: { kind: preview.artifact.kind, mimeType: media.mimeType, bytes: media.bytes } };
}

function toOpenFileState(file: DesktopFilePreview): OpenFileState {
  if (file.kind === 'image' || file.kind === 'audio' || file.kind === 'video') {
    if (file.media === undefined) return { status: 'ready', content: '' };
    return { status: 'ready', media: { kind: file.kind, mimeType: file.media.mimeType, bytes: file.media.bytes } };
  }
  return { status: 'ready', ...(file.content === undefined ? {} : { content: file.content }) };
}
