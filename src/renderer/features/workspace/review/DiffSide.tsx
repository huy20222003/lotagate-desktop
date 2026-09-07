import type { FileChangeDiff } from '../../../../contracts/ipc/v1/workspace.js';
import type { ThemedToken } from 'shiki';
import { DiffSyntaxText } from './DiffSyntaxText.js';

export function DiffSide({ line, kind, tokens, placeholderText }: { line: FileChangeDiff['lines'][number] | undefined; kind: 'addition' | 'deletion'; tokens?: ThemedToken[] | undefined; placeholderText?: string | undefined }) {
  if (line === undefined) return <div className="diff-side diff-side-empty"><span className="diff-line-number" aria-hidden="true" /><span className="diff-side-text" aria-hidden="true">{placeholderText ?? ''}</span></div>;
  return <div className={`diff-side diff-${line.kind === 'context' ? 'context' : kind}`}><span className="diff-line-number">{kind === 'addition' ? line.newLine ?? '' : line.oldLine ?? ''}</span><span className="diff-side-text">{line.kind === 'context' ? ' ' : kind === 'deletion' ? '-' : ''}<DiffSyntaxText text={line.text} tokens={tokens} /></span></div>;
}
