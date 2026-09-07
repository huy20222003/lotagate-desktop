import { type KeyboardEvent, useState } from 'react';
import { ChevronDown, ChevronRight, FileCode2 } from 'lucide-react';
import type { FileChangeDiff } from '../../../../contracts/ipc/v1/workspace.js';
import { CopyTextButton, Icon, IconButton, Tooltip } from '../../../components/ui.js';
import { FileChangeDiffContent } from './FileChangeDiffContent.js';
import { hasFileDiff, type DiffViewMode } from './file-change-view.js';
import { fileIconFor } from '../../../components/file-icon.js';

export function FileChangeItem({ change, onOpenFileChanges, onOpenFile, viewMode = 'unified', showActions = false, initiallyExpanded = true }: { change: FileChangeDiff; onOpenFileChanges?: (() => void) | undefined; onOpenFile?: (() => void) | undefined; viewMode?: DiffViewMode; showActions?: boolean; initiallyExpanded?: boolean }) {
  const [expanded, setExpanded] = useState(initiallyExpanded);
  const expandable = onOpenFileChanges === undefined;
  const toggleExpanded = () => setExpanded(current => !current);
  const handleHeaderKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (!expandable || event.target !== event.currentTarget) return;
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); toggleExpanded(); }
  };
  return <section className="file-change-item"><header className={expandable ? 'file-change-item-header is-expandable' : 'file-change-item-header'} role={expandable ? 'button' : undefined} tabIndex={expandable ? 0 : undefined} aria-expanded={expandable ? expanded : undefined} onClick={expandable ? toggleExpanded : undefined} onKeyDown={expandable ? handleHeaderKeyDown : undefined}><div className="file-change-path-wrap"><Icon icon={fileIconFor({ name: change.path })} size={14} />{onOpenFileChanges ? <Tooltip label={change.path}><button type="button" className="file-change-path" onClick={onOpenFileChanges}>{change.path}</button></Tooltip> : <Tooltip label={change.path}><strong>{change.path}</strong></Tooltip>}{hasFileDiff(change) ? <div className="file-change-counts"><span className="change-additions">+{change.additions}</span><span className="change-deletions">-{change.deletions}</span></div> : null}</div>{showActions ? <div className="file-change-actions" onClick={event => event.stopPropagation()}><CopyTextButton content={change.path} label="Copy path" /><IconButton icon={expanded ? ChevronDown : ChevronRight} iconSize={14} label={expanded ? `Collapse changes for ${change.path}` : `Expand changes for ${change.path}`} aria-expanded={expanded} onClick={toggleExpanded} /><IconButton icon={FileCode2} iconSize={14} label={`Open ${change.path} in a tab`} onClick={onOpenFile} /></div> : null}</header>{expandable && expanded ? <FileChangeDiffContent change={change} viewMode={viewMode} /> : null}</section>;
}
