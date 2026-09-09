import { ChevronDown, ChevronRight, Folder } from 'lucide-react';
import type { ReactNode } from 'react';
import type { WorkspaceFileSuggestion } from '../../../../contracts/ipc/v1/workspace.js';
import { Scrollbar } from '../../../components/Scrollbar.js';
import { fileName } from './file-change-view.js';
import { Icon, Skeleton } from '../../../components/ui.js';
import { fileIconFor } from '../../../components/file-icon.js';

export interface FolderContentsState {
  readonly items: WorkspaceFileSuggestion[];
  readonly loading: boolean;
}

export function FolderPopover({ rootFolder, folderContents, expandedFolders, onToggleFolder, onOpenFile }: { rootFolder: string; folderContents: ReadonlyMap<string, FolderContentsState>; expandedFolders: ReadonlySet<string>; onToggleFolder: (path: string) => void; onOpenFile: (path: string) => void }) {
  const root = folderContents.get(rootFolder);
  return <div className="file-content-folder-popover" role="menu"><Scrollbar className="file-content-folder-scrollbar">{root === undefined || root.loading ? <span className="file-content-folder-state" aria-label="Loading files"><Skeleton className="file-content-folder-skeleton" /></span> : root.items.length === 0 ? <span className="file-content-folder-state">No files in this folder.</span> : <div className="file-content-folder-options">{renderFolderItems(root.items, 0, expandedFolders, folderContents, onToggleFolder, onOpenFile)}</div>}</Scrollbar></div>;
}

function renderFolderItems(items: readonly WorkspaceFileSuggestion[], depth: number, expandedFolders: ReadonlySet<string>, folderContents: ReadonlyMap<string, FolderContentsState>, onToggleFolder: (path: string) => void, onOpenFile: (path: string) => void): ReactNode[] {
  return items.flatMap(item => {
    const folder = item.kind === 'folder';
    const expandable = folder && item.hasChildren !== false;
    const expanded = expandable && expandedFolders.has(item.path);
    const rows: ReactNode[] = [<button type="button" role="menuitem" className="file-content-folder-option" data-depth={depth} style={{ paddingLeft: `${7 + depth * 16}px` }} disabled={folder && !expandable} aria-expanded={expandable ? expanded : undefined} key={`${item.kind}:${item.path}`} onClick={() => folder ? onToggleFolder(item.path) : onOpenFile(item.path)}>{expandable ? <Icon icon={expanded ? ChevronDown : ChevronRight} size={13} /> : <span className="file-content-folder-chevron-spacer" aria-hidden="true" />}<Icon icon={folder ? Folder : fileIconFor({ name: item.path })} size={14} /><span>{fileName(item.path)}</span></button>];
    if (!expanded) return rows;
    const contents = folderContents.get(item.path);
    if (contents === undefined || contents.loading) return [...rows, <span className="file-content-folder-state is-nested" style={{ paddingLeft: `${23 + depth * 16}px` }} data-depth={depth + 1} key={`loading:${item.path}`}>Loading files…</span>];
    if (contents.items.length === 0) return [...rows, <span className="file-content-folder-state is-nested" style={{ paddingLeft: `${23 + depth * 16}px` }} data-depth={depth + 1} key={`empty:${item.path}`}>No files in this folder.</span>];
    return [...rows, ...renderFolderItems(contents.items, depth + 1, expandedFolders, folderContents, onToggleFolder, onOpenFile)];
  });
}
