import { Folder } from 'lucide-react';
import type { WorkspaceFileSuggestion } from '../../../contracts/ipc/v1/workspace.js';
import { Scrollbar } from '../../components/Scrollbar.js';
import { fileName } from './file-change-view.js';
import { Icon } from '../../components/ui.js';
import { fileIconFor } from './file-icon.js';

export function FolderPopover({ items, loading, onOpenFolder, onOpenFile }: { items: WorkspaceFileSuggestion[]; loading: boolean; onOpenFolder: (path: string) => void; onOpenFile: (path: string) => void }) {
  return <div className="file-content-folder-popover" role="menu"><Scrollbar className="file-content-folder-scrollbar">{loading ? <span className="file-content-folder-state">Loading files…</span> : items.length === 0 ? <span className="file-content-folder-state">No files in this folder.</span> : <div className="file-content-folder-options">{items.map(item => <button type="button" role="menuitem" className="file-content-folder-option" key={`${item.kind}:${item.path}`} onClick={() => item.kind === 'folder' ? onOpenFolder(item.path) : onOpenFile(item.path)}>{item.kind === 'folder' ? <Folder size={14} /> : <Icon icon={fileIconFor({ name: item.path })} size={14} />}<span>{fileName(item.path)}</span></button>)}</div>}</Scrollbar></div>;
}
