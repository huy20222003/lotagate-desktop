import type { FileChangeDiff } from '../../../../contracts/ipc/v1/workspace.js';
import type { ThemedToken } from 'shiki';
import { DiffSyntaxText } from './DiffSyntaxText.js';

export function DiffSide({ line, kind, tokens }: { line: FileChangeDiff['lines'][number] | undefined; kind: 'addition' | 'deletion'; tokens?: ThemedToken[] | undefined }) {
  return <div className={`diff-side ${line === undefined ? 'diff-side-empty' : `diff-${line.kind === 'context' ? 'context' : kind}`}`}>{line ? <><span className="diff-line-number">{kind === 'addition' ? line.newLine ?? '' : line.oldLine ?? ''}</span><span className="diff-side-text">{line.kind === 'context' ? ' ' : kind === 'deletion' ? '-' : ''}<DiffSyntaxText text={line.text} tokens={tokens} /></span></> : null}</div>;
}
