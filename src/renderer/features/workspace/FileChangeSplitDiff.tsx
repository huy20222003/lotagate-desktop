import type { FileChangeDiff } from '../../../contracts/ipc/v1/workspace.js';
import { DiffSide } from './DiffSide.js';
import { splitDiffLines } from './file-change-view.js';

export function FileChangeSplitDiff({ change }: { change: FileChangeDiff }) {
  return <div className="diff-split-scroll"><div className="diff-split">{splitDiffLines(change.lines).map((row, index) => <div className="diff-split-row" key={`${change.path}:split:${index}`}><DiffSide line={row.left} kind="deletion" /><DiffSide line={row.right} kind="addition" /></div>)}{change.truncated ? <div className="diff-truncated">… diff truncated …</div> : null}</div></div>;
}
