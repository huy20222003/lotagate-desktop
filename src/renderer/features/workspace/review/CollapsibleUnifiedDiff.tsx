import { useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import type { FileChangeDiff } from '../../../../contracts/ipc/v1/workspace.js';
import { CONTEXT_PREVIEW_LINES } from './file-change-view.js';
import { Scrollbar } from '../../../components/Scrollbar.js';
import { DiffSyntaxText } from './DiffSyntaxText.js';
import { useDiffHighlighting } from './use-diff-highlighting.js';

export function CollapsibleUnifiedDiff({ change }: { change: FileChangeDiff }) {
  const [expandedBlocks, setExpandedBlocks] = useState<Set<number>>(new Set());
  const highlightedLines = useDiffHighlighting(change);
  const output: ReactNode[] = [];
  for (let index = 0; index < change.lines.length;) {
    const line = change.lines[index];
    if (line?.kind !== 'context') { if (line !== undefined) output.push(renderDiffLine(change.path, line, index, highlightedLines?.[index])); index += 1; continue; }
    const start = index;
    while (change.lines[index]?.kind === 'context') index += 1;
    const end = index;
    const count = end - start;
    const expanded = expandedBlocks.has(start);
    const collapsible = !expanded && count > CONTEXT_PREVIEW_LINES * 2 + 1;
    const lines = collapsible ? [...change.lines.slice(start, start + CONTEXT_PREVIEW_LINES), ...change.lines.slice(end - CONTEXT_PREVIEW_LINES, end)] : change.lines.slice(start, end);
    lines.forEach((context, offset) => {
      const originalIndex = collapsible && offset >= CONTEXT_PREVIEW_LINES ? end - CONTEXT_PREVIEW_LINES + offset - CONTEXT_PREVIEW_LINES : start + offset;
      output.push(renderDiffLine(change.path, context!, originalIndex, highlightedLines?.[originalIndex]));
      if (collapsible && offset === CONTEXT_PREVIEW_LINES - 1) output.push(renderContextToggle(change.path, start, count, setExpandedBlocks));
    });
  }
  return <Scrollbar axis="both" className="unified-diff-scroll"><pre>{output}{change.truncated ? <code className="diff-truncated">… diff truncated …</code> : null}</pre></Scrollbar>;
}

function renderContextToggle(path: string, start: number, count: number, setExpandedBlocks: Dispatch<SetStateAction<Set<number>>>) {
  return <button type="button" className="diff-context-toggle" key={`${path}:context:${start}`} onClick={() => setExpandedBlocks(current => { const next = new Set(current); next.add(start); return next; })}>{count - CONTEXT_PREVIEW_LINES * 2} unmodified lines</button>;
}

function renderDiffLine(path: string, line: FileChangeDiff['lines'][number], index: number, tokens?: import('shiki').ThemedToken[]) {
  return <code className={`diff-line diff-${line.kind}`} key={`${path}:${index}`}><span className="diff-line-number">{line.newLine ?? line.oldLine ?? ''}</span><span>{line.kind === 'deletion' ? '-' : ' '}<DiffSyntaxText text={line.text} tokens={tokens} /></span></code>;
}
