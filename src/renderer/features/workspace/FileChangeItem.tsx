import { useState } from 'react';
import { ChevronDown, ChevronRight, Minus, Plus } from 'lucide-react';
import type { FileChangeDiff } from '../../../contracts/ipc/v1/workspace.js';
import { CopyTextButton, IconButton } from '../../components/ui.js';
import { FileChangeDiffContent } from './FileChangeDiffContent.js';
import type { DiffViewMode } from './file-change-view.js';
import { fileIconFor } from './file-icon.js';

export function FileChangeItem({ change, onOpenFileChanges, onOpenFile, viewMode = 'unified', showActions = false }: { change: FileChangeDiff; onOpenFileChanges?: (() => void) | undefined; onOpenFile?: (() => void) | undefined; viewMode?: DiffViewMode; showActions?: boolean }) {
  const [expanded, setExpanded] = useState(true);
  const expandable = onOpenFileChanges === undefined;
  return <section className="file-change-item"><header>{onOpenFileChanges ? <button type="button" className="file-change-path" title={change.path} onClick={onOpenFileChanges}>{change.path}</button> : <strong title={change.path}>{change.path}</strong>}<span><Plus size={12} />{change.additions}<Minus size={12} />{change.deletions}</span>{showActions ? <div className="file-change-actions"><CopyTextButton content={change.path} label="Copy path" /><IconButton icon={expanded ? ChevronDown : ChevronRight} iconSize={14} label={expanded ? `Collapse changes for ${change.path}` : `Expand changes for ${change.path}`} aria-expanded={expanded} onClick={() => setExpanded(current => !current)} /><IconButton icon={fileIconFor({ name: change.path })} iconSize={14} label={`Open ${change.path} in a tab`} onClick={onOpenFile} /></div> : null}</header>{expandable && expanded ? <FileChangeDiffContent change={change} viewMode={viewMode} /> : null}</section>;
}
