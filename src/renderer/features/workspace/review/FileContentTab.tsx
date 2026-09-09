import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ChevronRight, FolderOpen } from 'lucide-react';
import { Icon, Skeleton } from '../../../components/ui.js';
import { Scrollbar } from '../../../components/Scrollbar.js';
import { FolderPopover, type FolderContentsState } from './FolderPopover.js';
import { highlightFileContent, tokenStyle } from './file-syntax.js';
import type { OpenFileState } from './file-change-view.js';
import { displayFilePath, fileName, immediateFolderItems, relativeWorkspacePath } from './file-change-view.js';
import { DiffContextMenu } from './DiffContextMenu.js';
import { useTheme } from '../../../theme/theme.js';
import { FileMediaPreview } from './FileMediaPreview.js';

const absolutePathPattern = /^(?:[A-Za-z]:[\\/]|\\\\|\/(?!\/))/u;

export function FileContentTab({ cwd, path, file, onOpenPath }: { cwd: string; path: string; file?: OpenFileState | undefined; onOpenPath: (path: string) => void }) {
  const [openFolder, setOpenFolder] = useState<string | undefined>();
  const [folderContents, setFolderContents] = useState<Map<string, FolderContentsState>>(new Map());
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [lineWrap, setLineWrap] = useState(true);
  const [highlightedLines, setHighlightedLines] = useState<Awaited<ReturnType<typeof highlightFileContent>>>();
  const folderRef = useRef<HTMLDivElement>(null);
  const requestedFoldersRef = useRef<Set<string>>(new Set());
  const breadcrumbViewportRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ startX: number; startScrollLeft: number; captured: boolean }>();
  const { theme } = useTheme();
  const externalPath = absolutePathPattern.test(path);
  const breadcrumbPath = externalPath ? displayFilePath(path) : relativeWorkspacePath(cwd, path);
  const segments = breadcrumbPath.split('/').filter(Boolean);

  useEffect(() => {
    setOpenFolder(undefined);
    requestedFoldersRef.current.clear();
    setFolderContents(new Map());
    setExpandedFolders(new Set());
  }, [path]);
  useEffect(() => {
    if (openFolder === undefined) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!folderRef.current?.contains(event.target as Node)) setOpenFolder(undefined);
    };
    document.addEventListener('pointerdown', closeOnOutsideClick);
    return () => document.removeEventListener('pointerdown', closeOnOutsideClick);
  }, [openFolder]);
  const loadFolder = useCallback(async (folder: string) => {
    try {
      const suggestions = externalPath ? await window.lotagate.operations.listDirectory(folder) : await window.lotagate.workspaces.fileSuggestions(cwd, folder);
      const items = externalPath ? suggestions : immediateFolderItems(suggestions, folder);
      setFolderContents(current => new Map(current).set(folder, { items, loading: false }));
    } catch {
      setFolderContents(current => new Map(current).set(folder, { items: [], loading: false }));
    }
  }, [cwd, externalPath]);
  const requestFolder = useCallback((folder: string) => {
    if (requestedFoldersRef.current.has(folder)) return;
    requestedFoldersRef.current.add(folder);
    setFolderContents(current => new Map(current).set(folder, { items: [], loading: true }));
    void loadFolder(folder);
  }, [loadFolder]);
  useEffect(() => {
    if (openFolder === undefined) return;
    requestedFoldersRef.current.clear();
    setFolderContents(new Map());
    setExpandedFolders(new Set());
    requestFolder(openFolder);
  }, [openFolder, requestFolder]);
  const togglePopoverFolder = useCallback((folder: string) => {
    setExpandedFolders(current => {
      const next = new Set(current);
      if (next.has(folder)) next.delete(folder);
      else next.add(folder);
      return next;
    });
    requestFolder(folder);
  }, [requestFolder]);
  useLayoutEffect(() => {
    const viewport = breadcrumbViewportRef.current;
    if (viewport) viewport.scrollLeft = viewport.scrollWidth;
  }, [breadcrumbPath, file?.status]);
  useEffect(() => {
    const viewport = breadcrumbViewportRef.current;
    if (viewport === null) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (event.button !== 0 || viewport.scrollWidth <= viewport.clientWidth) return;
      dragRef.current = { startX: event.clientX, startScrollLeft: viewport.scrollLeft, captured: false };
    };
    const handlePointerMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (drag === undefined) return;
      const delta = event.clientX - drag.startX;
      if (!drag.captured && Math.abs(delta) < 4) return;
      if (!drag.captured) {
        drag.captured = true;
        viewport.setPointerCapture(event.pointerId);
        viewport.classList.add('is-dragging');
      }
      viewport.scrollLeft = drag.startScrollLeft - delta;
    };
    const stopDragging = (event: PointerEvent) => {
      if (dragRef.current === undefined) return;
      if (viewport.hasPointerCapture(event.pointerId)) viewport.releasePointerCapture(event.pointerId);
      dragRef.current = undefined;
      viewport.classList.remove('is-dragging');
    };
    viewport.addEventListener('pointerdown', handlePointerDown);
    viewport.addEventListener('pointermove', handlePointerMove);
    viewport.addEventListener('pointerup', stopDragging);
    viewport.addEventListener('pointercancel', stopDragging);
    return () => {
      viewport.removeEventListener('pointerdown', handlePointerDown);
      viewport.removeEventListener('pointermove', handlePointerMove);
      viewport.removeEventListener('pointerup', stopDragging);
      viewport.removeEventListener('pointercancel', stopDragging);
    };
  }, [file?.status]);
  useEffect(() => {
    if (file?.status !== 'ready') {
      setHighlightedLines(undefined);
      return;
    }
    const content = file.content ?? '';
    let cancelled = false;
    setHighlightedLines(undefined);
    void highlightFileContent(content, path, theme === 'dark' ? 'dark-plus' : 'light-plus').then(lines => {
      if (!cancelled) setHighlightedLines(lines);
    }).catch(() => {
      if (!cancelled) setHighlightedLines(undefined);
    });
    return () => { cancelled = true; };
  }, [file?.content, file?.status, path, theme]);

  const breadcrumb = externalPath
    ? absoluteBreadcrumb(segments, breadcrumbPath)
    : [{ label: fileName(cwd), path: '', folder: true }, ...segments.map((segment, index) => ({ label: segment, path: segments.slice(0, index + 1).join('/'), folder: index < segments.length - 1 }))];
  const lines = (file?.content ?? '').replaceAll('\r\n', '\n').split('\n');
  return <div className="file-content-view">
    <div ref={folderRef} className="file-content-breadcrumb-wrap">
      <Scrollbar axis="horizontal" className="file-content-breadcrumb-scrollbar" viewportRef={breadcrumbViewportRef}>
        <nav className="file-content-breadcrumb" aria-label="File path">
          {breadcrumb.map((item, index) => <span className="file-content-breadcrumb-item" key={`${index}:${item.label}`}>
            {index > 0 ? <Icon icon={ChevronRight} size={13} /> : null}
            {item.folder ? <button type="button" className="file-content-breadcrumb-button" aria-expanded={openFolder === item.path} onClick={() => setOpenFolder(current => current === item.path ? undefined : item.path)}>{index === 0 ? <Icon icon={FolderOpen} size={14} /> : null}<span>{item.label}</span></button> : <span className="file-content-breadcrumb-current">{item.label}</span>}
          </span>)}
        </nav>
      </Scrollbar>
      {openFolder !== undefined ? <FolderPopover rootFolder={openFolder} folderContents={folderContents} expandedFolders={expandedFolders} onToggleFolder={togglePopoverFolder} onOpenFile={pathValue => { setOpenFolder(undefined); onOpenPath(pathValue); }} /> : null}
    </div>
    {file?.status === 'loading' ? <div className="file-content-state" aria-label={`Loading ${fileName(path)}`}><Skeleton className="file-content-skeleton" /></div> : file?.status === 'error' ? <div className="file-content-state file-content-error"><strong>Unable to open file</strong><span>{file.error}</span></div> : file?.media !== undefined ? <Scrollbar className="file-content-media-scroll"><div className="file-content-media-preview"><FileMediaPreview path={path} media={file.media} /></div></Scrollbar> : file?.content === undefined ? <div className="file-content-state"><span>Preview is not available for this file type.</span></div> : <DiffContextMenu path={path} workspaceCwd={cwd} lineWrap={lineWrap} onToggleLineWrap={() => setLineWrap(current => !current)}>
      <Scrollbar className="file-content-scroll">
        <pre className={`file-content${lineWrap ? ' is-wrapped' : ''}`}>{lines.map((line, index) => <code className="file-content-line" key={`${path}:${index}`}><span className="file-content-line-number">{index + 1}</span><span>{highlightedLines?.[index]?.map((token, tokenIndex) => <span key={`${path}:${index}:${tokenIndex}`} style={tokenStyle(token)}>{token.content}</span>) ?? (line || ' ')}</span></code>)}</pre>
      </Scrollbar>
    </DiffContextMenu>}
  </div>;
}

function absoluteBreadcrumb(segments: readonly string[], normalizedPath: string): Array<{ label: string; path: string; folder: boolean }> {
  const isUncPath = normalizedPath.startsWith('//');
  const isPosixPath = normalizedPath.startsWith('/') && !isUncPath;
  return segments.map((label, index) => {
    const joined = segments.slice(0, index + 1).join('/');
    const path = isUncPath ? `//${joined}` : isPosixPath ? `/${joined}` : index === 0 && /^[A-Za-z]:$/u.test(label) ? `${joined}/` : joined;
    return { label, path, folder: index < segments.length - 1 };
  });
}
