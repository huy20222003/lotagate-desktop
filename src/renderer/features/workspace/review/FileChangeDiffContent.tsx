import { useEffect, useState } from 'react';
import type { FileChangeDiff } from '../../../../contracts/ipc/v1/workspace.js';
import { CollapsibleUnifiedDiff } from './CollapsibleUnifiedDiff.js';
import { FileChangeSplitDiff } from './FileChangeSplitDiff.js';
import type { DiffViewMode } from './file-change-view.js';
import { DiffContextMenu } from './DiffContextMenu.js';

export function FileChangeDiffContent({ change, viewMode = 'unified', workspaceCwd }: { change: FileChangeDiff; viewMode?: DiffViewMode; workspaceCwd?: string | undefined }) {
  const [lineWrap, setLineWrap] = useState(viewMode === 'unified');
  useEffect(() => setLineWrap(viewMode === 'unified'), [viewMode]);
  return <DiffContextMenu path={change.path} workspaceCwd={workspaceCwd} lineWrap={lineWrap} onToggleLineWrap={() => setLineWrap(current => !current)}>{viewMode === 'split' ? <FileChangeSplitDiff change={change} wrapLines={lineWrap} /> : <CollapsibleUnifiedDiff change={change} wrapLines={lineWrap} />}</DiffContextMenu>;
}
