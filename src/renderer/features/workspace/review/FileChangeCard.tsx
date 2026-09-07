import { useState, type KeyboardEvent, type MouseEvent } from 'react';
import { ChevronDown, ChevronUp, Eye, FileDiff, Undo2 } from 'lucide-react';
import type { CheckpointUndoState, FileChangeSummary } from '../../../../contracts/ipc/v1/workspace.js';
import { Button, Icon } from '../../../components/ui.js';
import { FileChangeItem } from './FileChangeItem.js';
import { fileName, hasFileDiff, type OpenFileChangesHandler } from './file-change-view.js';

const MAX_VISIBLE_FILE_CHANGES = 3;

export function FileChangeCard({ summary, undoState, undoBusy = false, onUndo, onOpenFileChanges }: { summary: FileChangeSummary; undoState?: CheckpointUndoState; undoBusy?: boolean; onUndo?: () => Promise<void>; onOpenFileChanges: OpenFileChangesHandler }) {
  const [filesExpanded, setFilesExpanded] = useState(false);
  const canUndo = undoState === 'ready' && !undoBusy && onUndo !== undefined;
  const undoLabel = undoBusy ? 'Undoing…' : undoState === 'undone' ? 'Undone' : undoState === 'conflict' ? 'Conflict' : undoState === 'failed' ? 'Undo failed' : 'Undo';
  const singleFile = summary.files.length === 1 ? summary.files[0] : undefined;
  const remainingFileCount = summary.files.length - MAX_VISIBLE_FILE_CHANGES;
  const visibleFiles = filesExpanded ? summary.files : summary.files.slice(0, MAX_VISIBLE_FILE_CHANGES);
  const showDiffCounts = hasFileDiff(summary);
  const handleCardClick = (event: MouseEvent<HTMLElement>) => {
    const target = event.target as Element;
    if ((target.closest('button') !== null) || (singleFile === undefined && target.closest('header') === null)) return;
    onOpenFileChanges(summary);
  };
  const handleCardKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onOpenFileChanges(summary);
    }
  };
  const isClickable = summary.files.length > 0;
  return <section className={`file-change-card${isClickable ? ' is-clickable' : ''}`} aria-label="Edited files" tabIndex={isClickable ? 0 : undefined} onClick={isClickable ? handleCardClick : undefined} onKeyDown={isClickable ? handleCardKeyDown : undefined}><header><div className="file-change-card-heading"><div className="file-change-card-icon"><Icon icon={FileDiff} size={22} /></div><div className="file-change-card-summary"><div className="file-change-card-title"><strong>{singleFile ? `Edited ${fileName(singleFile.path)}` : `Edited ${summary.files.length} files`}</strong></div>{showDiffCounts ? <div className="file-change-card-counts"><span className="change-additions">+{summary.additions}</span><span className="change-deletions">-{summary.deletions}</span></div> : null}</div></div><div className="file-change-card-actions"><Button variant="ghost" className="file-change-card-action" disabled={!canUndo} title={canUndo ? 'Undo all changes from this turn' : undoState === undefined ? 'Undo checkpoint is not available' : undoLabel} onClick={() => { if (onUndo !== undefined) void onUndo(); }}><Icon icon={Undo2} size={14} />{undoLabel}</Button><Button variant="secondary" className="file-change-card-action" onClick={() => onOpenFileChanges(summary)}><Icon icon={Eye} size={14} />Review</Button></div></header>{singleFile === undefined ? <><div className="file-change-card-list">{visibleFiles.map(change => <FileChangeItem key={change.path} change={change} onOpenFileChanges={() => onOpenFileChanges(summary, change.path)} />)}</div>{remainingFileCount > 0 ? <button type="button" className="file-change-card-more" aria-expanded={filesExpanded} onClick={() => setFilesExpanded(current => !current)}>{filesExpanded ? 'Show fewer files' : `Show ${remainingFileCount} more files`}<Icon icon={filesExpanded ? ChevronUp : ChevronDown} size={14} /></button> : null}</> : null}</section>;
}
