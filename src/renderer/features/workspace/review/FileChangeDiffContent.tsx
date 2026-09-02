import type { FileChangeDiff } from '../../../../contracts/ipc/v1/workspace.js';
import { CollapsibleUnifiedDiff } from './CollapsibleUnifiedDiff.js';
import { FileChangeSplitDiff } from './FileChangeSplitDiff.js';
import type { DiffViewMode } from './file-change-view.js';

export function FileChangeDiffContent({ change, viewMode = 'unified' }: { change: FileChangeDiff; viewMode?: DiffViewMode }) {
  return viewMode === 'split' ? <FileChangeSplitDiff change={change} /> : <CollapsibleUnifiedDiff change={change} />;
}
