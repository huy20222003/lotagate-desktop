import type { KeyboardEvent, MouseEvent } from 'react';
import { Eye, FileDiff, Undo2 } from 'lucide-react';
import type { CheckpointUndoState, FileChangeSummary } from '../../../../contracts/ipc/v1/workspace.js';
import { Button, Icon } from '../../../components/ui.js';
import { FileChangeItem } from './FileChangeItem.js';
import { fileName } from './file-change-view.js';

export function FileChangeCard({ summary, undoState, undoBusy = false, onUndo, onOpenFileChanges }: { summary: FileChangeSummary; undoState?: CheckpointUndoState; undoBusy?: boolean; onUndo?: () => Promise<void>; onOpenFileChanges: (summary: FileChangeSummary) => void }) {
  const canUndo = undoState === 'ready' && !undoBusy && onUndo !== undefined;
  const undoLabel = undoBusy ? 'Undoing…' : undoState === 'undone' ? 'Undone' : undoState === 'conflict' ? 'Conflict' : undoState === 'failed' ? 'Undo failed' : 'Undo';
  const singleFile = summary.files.length === 1 ? summary.files[0] : undefined;
  const handleCardClick = (event: MouseEvent<HTMLElement>) => {
    if (singleFile === undefined || (event.target as Element).closest('button') !== null) return;
    onOpenFileChanges(summary);
  };
  const handleCardKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (singleFile === undefined || event.target !== event.currentTarget) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onOpenFileChanges(summary);
    }
  };
  return <section className={`file-change-card${singleFile === undefined ? '' : ' is-clickable'}`} aria-label="Edited files" tabIndex={singleFile === undefined ? undefined : 0} onClick={singleFile === undefined ? undefined : handleCardClick} onKeyDown={singleFile === undefined ? undefined : handleCardKeyDown}><header><div className="file-change-card-heading"><div className="file-change-card-icon"><Icon icon={FileDiff} size={22} /></div><div className="file-change-card-summary"><div className="file-change-card-title"><strong>{singleFile ? `Edited ${fileName(singleFile.path)}` : `Edited ${summary.files.length} files`}</strong></div><div className="file-change-card-counts"><span className="change-additions">+{summary.additions}</span><span className="change-deletions">-{summary.deletions}</span></div></div></div><div className="file-change-card-actions"><Button variant="ghost" className="file-change-card-action" disabled={!canUndo} title={canUndo ? 'Undo all changes from this turn' : undoState === undefined ? 'Undo checkpoint is not available' : undoLabel} onClick={() => { if (onUndo !== undefined) void onUndo(); }}><Icon icon={Undo2} size={14} />{undoLabel}</Button><Button variant="secondary" className="file-change-card-action" onClick={() => onOpenFileChanges(summary)}><Icon icon={Eye} size={14} />Review</Button></div></header>{singleFile === undefined ? <div className="file-change-card-list">{summary.files.map(change => <FileChangeItem key={change.path} change={change} onOpenFileChanges={() => onOpenFileChanges(summary)} />)}</div> : null}</section>;
}
