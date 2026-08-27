import { useState, type ReactNode } from 'react';
import type { FileChangeDiff } from '../../../contracts/ipc/v1/workspace.js';
import { CONTEXT_PREVIEW_LINES } from './file-change-view.js';

export function CollapsibleUnifiedDiff({ change }: { change: FileChangeDiff }) {
  const [expandedBlocks, setExpandedBlocks] = useState<Set<number>>(new Set());
  const output: ReactNode[] = [];
  for (let index = 0; index < change.lines.length;) {
    const line = change.lines[index];
    if (line?.kind !== 'context') { if (line !== undefined) output.push(renderDiffLine(change.path, line, index)); index += 1; continue; }
    const start = index;
    while (change.lines[index]?.kind === 'context') index += 1;
    const end = index;
    const count = end - start;
    const expanded = expandedBlocks.has(start);
    const lines = expanded || count <= CONTEXT_PREVIEW_LINES * 2 + 1 ? change.lines.slice(start, end) : [...change.lines.slice(start, start + CONTEXT_PREVIEW_LINES), ...change.lines.slice(end - CONTEXT_PREVIEW_LINES, end)];
    lines.forEach((context, offset) => { const originalIndex = expanded || count <= CONTEXT_PREVIEW_LINES * 2 + 1 ? start + offset : offset < CONTEXT_PREVIEW_LINES ? start + offset : end - CONTEXT_PREVIEW_LINES + offset - CONTEXT_PREVIEW_LINES; output.push(renderDiffLine(change.path, context!, originalIndex)); });
    if (!expanded && count > CONTEXT_PREVIEW_LINES * 2 + 1) output.push(<button type="button" className="diff-context-toggle" key={`${change.path}:context:${start}`} onClick={() => setExpandedBlocks(current => { const next = new Set(current); next.add(start); return next; })}>{count - CONTEXT_PREVIEW_LINES * 2} unmodified lines</button>);
  }
  return <pre>{output}{change.truncated ? <code className="diff-truncated">… diff truncated …</code> : null}</pre>;
}

function renderDiffLine(path: string, line: FileChangeDiff['lines'][number], index: number) {
  return <code className={`diff-line diff-${line.kind}`} key={`${path}:${index}`}><span className="diff-line-number">{line.newLine ?? line.oldLine ?? ''}</span><span>{line.kind === 'deletion' ? '-' : ' '}{line.text}</span></code>;
}
