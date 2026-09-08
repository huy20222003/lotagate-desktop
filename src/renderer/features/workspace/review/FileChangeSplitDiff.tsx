import type { FileChangeDiff } from '../../../../contracts/ipc/v1/workspace.js';
import { DiffSide } from './DiffSide.js';
import { splitDiffLines } from './file-change-view.js';
import { Scrollbar } from '../../../components/Scrollbar.js';
import { useDiffHighlighting } from './use-diff-highlighting.js';

export function FileChangeSplitDiff({ change, wrapLines = false }: { change: FileChangeDiff; wrapLines?: boolean }) {
  const highlightedLines = useDiffHighlighting(change);
  const rows = splitDiffLines(change.lines);
  return <Scrollbar axis="both" className="diff-split-scroll"><div className={`diff-split${wrapLines ? ' is-wrapped' : ''}`}>{rows.map((row, index) => <div className="diff-split-row" key={`${change.path}:split:${index}`}><DiffSide line={row.left} kind="deletion" placeholderText={row.right?.text} tokens={row.left ? highlightedLines?.[change.lines.indexOf(row.left)] : undefined} /><DiffSide line={row.right} kind="addition" placeholderText={row.left?.text} tokens={row.right ? highlightedLines?.[change.lines.indexOf(row.right)] : undefined} /></div>)}{change.truncated ? <div className="diff-truncated">… diff truncated …</div> : null}</div></Scrollbar>;
}
