import { useState } from 'react';
import { ChevronDown, ChevronRight, FileCode2, Minus, Plus } from 'lucide-react';
import type { FileChangeDiff } from '../../../contracts/ipc/v1/workspace.js';
import { CopyTextButton, Tooltip } from '../../components/ui.js';
import { FileChangeDiffContent } from './FileChangeDiffContent.js';
import type { DiffViewMode } from './file-change-view.js';

export function FileChangeItem({ change, onOpenFileChanges, onOpenFile, viewMode = 'unified', showActions = false }: { change: FileChangeDiff; onOpenFileChanges?: (() => void) | undefined; onOpenFile?: (() => void) | undefined; viewMode?: DiffViewMode; showActions?: boolean }) {
  const [expanded, setExpanded] = useState(true);
  const expandable = onOpenFileChanges === undefined;
  return <section className="file-change-item"><header>{onOpenFileChanges ? <button type="button" className="file-change-path" title={change.path} onClick={onOpenFileChanges}>{change.path}</button> : <strong title={change.path}>{change.path}</strong>}<span><Plus size={12} />{change.additions}<Minus size={12} />{change.deletions}</span>{showActions ? <div className="file-change-actions"><CopyTextButton content={change.path} label="Copy path" /><Tooltip label={expanded ? 'Collapse file' : 'Expand file'}><button type="button" className="icon-button ui-icon-button" aria-label={expanded ? `Collapse changes for ${change.path}` : `Expand changes for ${change.path}`} aria-expanded={expanded} onClick={() => setExpanded(current => !current)}>{expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</button></Tooltip><Tooltip label="Open file in a tab"><button type="button" className="icon-button ui-icon-button" aria-label={`Open ${change.path} in a tab`} onClick={onOpenFile}><FileCode2 size={14} /></button></Tooltip></div> : null}</header>{expandable && expanded ? <FileChangeDiffContent change={change} viewMode={viewMode} /> : null}</section>;
}
