import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ChevronRight, FolderOpen } from 'lucide-react';
import type { WorkspaceFileSuggestion } from '../../../../contracts/ipc/v1/workspace.js';
import { Icon, Skeleton } from '../../../components/ui.js';
import { Scrollbar } from '../../../components/Scrollbar.js';
import { FolderPopover } from './FolderPopover.js';
import { highlightFileContent, tokenStyle } from './file-syntax.js';
import type { OpenFileState } from './file-change-view.js';
import { displayFilePath, fileName, immediateFolderItems, relativeWorkspacePath } from './file-change-view.js';
import { DiffContextMenu } from './DiffContextMenu.js';
import { useTheme } from '../../../theme/theme.js';

const absolutePathPattern = /^(?:[A-Za-z]:[\\/]|\\\\|\/(?!\/))/u;

export function FileContentTab({ cwd, path, file, onOpenPath }: { cwd: string; path: string; file?: OpenFileState | undefined; onOpenPath: (path: string) => void }) {
  const [openFolder, setOpenFolder] = useState<string | undefined>();
  const [folderItems, setFolderItems] = useState<WorkspaceFileSuggestion[]>([]);
  const [folderLoading, setFolderLoading] = useState(false);
  const [lineWrap, setLineWrap] = useState(false);
  const [highlightedLines, setHighlightedLines] = useState<Awaited<ReturnType<typeof highlightFileContent>>>();
  const folderRef = useRef<HTMLDivElement>(null);
  const breadcrumbViewportRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ startX: number; startScrollLeft: number }>();
  const { theme } = useTheme();
  const externalPath = absolutePathPattern.test(path);
  const breadcrumbPath = externalPath ? displayFilePath(path) : relativeWorkspacePath(cwd, path);
  const segments = breadcrumbPath.split('/').filter(Boolean);

  useEffect(() => setOpenFolder(undefined), [path]);
  useEffect(() => {
    if (openFolder === undefined) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!folderRef.current?.contains(event.target as Node)) setOpenFolder(undefined);
    };
    document.addEventListener('pointerdown', closeOnOutsideClick);
    return () => document.removeEventListener('pointerdown', closeOnOutsideClick);
  }, [openFolder]);
  useEffect(() => {
    if (openFolder === undefined || externalPath) return;
    let cancelled = false;
    setFolderLoading(true);
    void window.lotagate.workspaces.fileSuggestions(cwd, openFolder).then(suggestions => {
      if (!cancelled) setFolderItems(immediateFolderItems(suggestions, openFolder));
    }).catch(() => {
      if (!cancelled) setFolderItems([]);
    }).finally(() => {
      if (!cancelled) setFolderLoading(false);
    });
    return () => { cancelled = true; };
  }, [cwd, externalPath, openFolder]);
  useLayoutEffect(() => {
    const viewport = breadcrumbViewportRef.current;
    if (viewport) viewport.scrollLeft = viewport.scrollWidth;
  }, [breadcrumbPath, file?.status]);
  useEffect(() => {
    const viewport = breadcrumbViewportRef.current;
    if (viewport === null) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (event.button !== 0 || viewport.scrollWidth <= viewport.clientWidth) return;
      dragRef.current = { startX: event.clientX, startScrollLeft: viewport.scrollLeft };
      viewport.setPointerCapture(event.pointerId);
      viewport.classList.add('is-dragging');
    };
    const handlePointerMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (drag) viewport.scrollLeft = drag.startScrollLeft - (event.clientX - drag.startX);
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
    ? segments.map(segment => ({ label: segment, path: '', folder: false }))
    : [{ label: fileName(cwd), path: '', folder: true }, ...segments.map((segment, index) => ({ label: segment, path: segments.slice(0, index + 1).join('/'), folder: index < segments.length - 1 }))];
  if (file?.status === 'loading') return <div className="file-content-state" aria-label={`Loading ${fileName(path)}`}><Skeleton className="file-content-skeleton" /></div>;
  if (file?.status === 'error') return <div className="file-content-state file-content-error"><strong>Unable to open file</strong><span>{file.error}</span></div>;
  const lines = (file?.content ?? '').replaceAll('\r\n', '\n').split('\n');
  return <div className="file-content-view">
    <div ref={folderRef} className="file-content-breadcrumb-wrap">
      <Scrollbar axis="horizontal" className="file-content-breadcrumb-scrollbar" viewportRef={breadcrumbViewportRef}>
        <nav className="file-content-breadcrumb" aria-label="File path">
          {breadcrumb.map((item, index) => <span className="file-content-breadcrumb-item" key={`${index}:${item.label}`}>
            {index > 0 ? <Icon icon={ChevronRight} size={13} /> : null}
            {!externalPath && item.folder ? <button type="button" className="file-content-breadcrumb-button" aria-expanded={openFolder === item.path} onClick={() => setOpenFolder(current => current === item.path ? undefined : item.path)}>{index === 0 ? <Icon icon={FolderOpen} size={14} /> : null}<span>{item.label}</span></button> : <span className="file-content-breadcrumb-current">{item.label}</span>}
          </span>)}
        </nav>
      </Scrollbar>
      {openFolder !== undefined ? <FolderPopover items={folderItems} loading={folderLoading} onOpenFolder={setOpenFolder} onOpenFile={pathValue => { setOpenFolder(undefined); onOpenPath(pathValue); }} /> : null}
    </div>
    <DiffContextMenu path={path} workspaceCwd={cwd} lineWrap={lineWrap} onToggleLineWrap={() => setLineWrap(current => !current)}>
      <Scrollbar className="file-content-scroll">
        <pre className={`file-content${lineWrap ? ' is-wrapped' : ''}`}>{lines.map((line, index) => <code className="file-content-line" key={`${path}:${index}`}><span className="file-content-line-number">{index + 1}</span><span>{highlightedLines?.[index]?.map((token, tokenIndex) => <span key={`${path}:${index}:${tokenIndex}`} style={tokenStyle(token)}>{token.content}</span>) ?? (line || ' ')}</span></code>)}</pre>
      </Scrollbar>
    </DiffContextMenu>
  </div>;
}
