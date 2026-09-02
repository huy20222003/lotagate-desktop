import type { FileChangeDiff } from '../../../../contracts/ipc/v1/workspace.js';
import { DiffSide } from './DiffSide.js';
import { splitDiffLines } from './file-change-view.js';
import { Scrollbar } from '../../../components/Scrollbar.js';
import { useDiffHighlighting } from './use-diff-highlighting.js';

export function FileChangeSplitDiff({ change }: { change: FileChangeDiff }) {
  const highlightedLines = useDiffHighlighting(change);
  return <Scrollbar axis="both" className="diff-split-scroll"><div className="diff-split">{splitDiffLines(change.lines).map((row, index) => <div className="diff-split-row" key={`${change.path}:split:${index}`}><DiffSide line={row.left} kind="deletion" tokens={row.left ? highlightedLines?.[change.lines.indexOf(row.left)] : undefined} /><DiffSide line={row.right} kind="addition" tokens={row.right ? highlightedLines?.[change.lines.indexOf(row.right)] : undefined} /></div>)}{change.truncated ? <div className="diff-truncated">… diff truncated …</div> : null}</div></Scrollbar>;
}
