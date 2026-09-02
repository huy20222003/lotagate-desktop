import { useEffect, useRef, useState } from 'react';
import { ChevronRight, FolderOpen, LoaderCircle } from 'lucide-react';
import type { WorkspaceFileSuggestion } from '../../../../contracts/ipc/v1/workspace.js';
import { Icon } from '../../../components/ui.js';
import { Scrollbar } from '../../../components/Scrollbar.js';
import { FolderPopover } from './FolderPopover.js';
import { highlightFileContent, tokenStyle } from './file-syntax.js';
import type { OpenFileState } from './file-change-view.js';
import { fileName, immediateFolderItems, relativeWorkspacePath } from './file-change-view.js';
import { useTheme } from '../../../theme/theme.js';

export function FileContentTab({ cwd, path, file, onOpenPath }: { cwd: string; path: string; file?: OpenFileState | undefined; onOpenPath: (path: string) => void }) {
  const [openFolder, setOpenFolder] = useState<string | undefined>();
  const [folderItems, setFolderItems] = useState<WorkspaceFileSuggestion[]>([]);
  const [folderLoading, setFolderLoading] = useState(false);
  const [highlightedLines, setHighlightedLines] = useState<Awaited<ReturnType<typeof highlightFileContent>>>();
  const folderRef = useRef<HTMLDivElement>(null);
  const { theme } = useTheme();
  const relativePath = relativeWorkspacePath(cwd, path);
  const segments = relativePath.split('/').filter(Boolean);
  useEffect(() => setOpenFolder(undefined), [path]);
  useEffect(() => { if (openFolder === undefined) return; const closeOnOutsideClick = (event: PointerEvent) => { if (!folderRef.current?.contains(event.target as Node)) setOpenFolder(undefined); }; document.addEventListener('pointerdown', closeOnOutsideClick); return () => document.removeEventListener('pointerdown', closeOnOutsideClick); }, [openFolder]);
  useEffect(() => { if (openFolder === undefined) return; let cancelled = false; setFolderLoading(true); void window.lotagate.workspaces.fileSuggestions(cwd, openFolder).then(suggestions => { if (!cancelled) setFolderItems(immediateFolderItems(suggestions, openFolder)); }).catch(() => { if (!cancelled) setFolderItems([]); }).finally(() => { if (!cancelled) setFolderLoading(false); }); return () => { cancelled = true; }; }, [cwd, openFolder]);
  useEffect(() => {
    if (file?.status !== 'ready') { setHighlightedLines(undefined); return; }
    const content = file.content ?? '';
    let cancelled = false;
    setHighlightedLines(undefined);
    void highlightFileContent(content, path, theme === 'dark' ? 'dark-plus' : 'light-plus').then(lines => { if (!cancelled) setHighlightedLines(lines); }).catch(() => { if (!cancelled) setHighlightedLines(undefined); });
    return () => { cancelled = true; };
  }, [file?.content, file?.status, path, theme]);
  const breadcrumb = [{ label: fileName(cwd), path: '' }, ...segments.map((segment, index) => ({ label: segment, path: segments.slice(0, index + 1).join('/'), folder: index < segments.length - 1 }))];
  if (file?.status === 'loading') return <div className="file-content-state"><Icon icon={LoaderCircle} size={18} className="spin" /><span>Loading {fileName(path)}…</span></div>;
  if (file?.status === 'error') return <div className="file-content-state file-content-error"><strong>Unable to open file</strong><span>{file.error}</span></div>;
  const lines = (file?.content ?? '').replaceAll('\r\n', '\n').split('\n');
  return <div className="file-content-view"><div ref={folderRef} className="file-content-breadcrumb-wrap"><Scrollbar axis="horizontal" className="file-content-breadcrumb-scrollbar"><nav className="file-content-breadcrumb" aria-label="File path">{breadcrumb.map((item, index) => <span className="file-content-breadcrumb-item" key={item.path || item.label}>{index > 0 ? <Icon icon={ChevronRight} size={13} /> : null}{index < breadcrumb.length - 1 ? <button type="button" className="file-content-breadcrumb-button" aria-expanded={openFolder === item.path} onClick={() => setOpenFolder(current => current === item.path ? undefined : item.path)}>{index === 0 ? <Icon icon={FolderOpen} size={14} /> : null}<span>{item.label}</span></button> : <span className="file-content-breadcrumb-current">{item.label}</span>}</span>)}</nav></Scrollbar>{openFolder !== undefined ? <FolderPopover items={folderItems} loading={folderLoading} onOpenFolder={setOpenFolder} onOpenFile={pathValue => { setOpenFolder(undefined); onOpenPath(pathValue); }} /> : null}</div><Scrollbar className="file-content-scroll"><pre className="file-content">{lines.map((line, index) => <code className="file-content-line" key={`${path}:${index}`}><span className="file-content-line-number">{index + 1}</span><span>{highlightedLines?.[index]?.map((token, tokenIndex) => <span key={`${path}:${index}:${tokenIndex}`} style={tokenStyle(token)}>{token.content}</span>) ?? (line || ' ')}</span></code>)}</pre></Scrollbar></div>;
}
