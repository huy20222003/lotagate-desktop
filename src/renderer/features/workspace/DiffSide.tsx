import type { FileChangeDiff } from '../../../contracts/ipc/v1/workspace.js';

export function DiffSide({ line, kind }: { line: FileChangeDiff['lines'][number] | undefined; kind: 'addition' | 'deletion' }) {
  return <div className={`diff-side ${line === undefined ? 'diff-side-empty' : `diff-${line.kind === 'context' ? 'context' : kind}`}`}>{line ? <><span className="diff-line-number">{kind === 'addition' ? line.newLine ?? '' : line.oldLine ?? ''}</span><span className="diff-side-text">{line.kind === 'context' ? ` ${line.text}` : `${kind === 'deletion' ? '-' : ''}${line.text}`}</span></> : null}</div>;
}
