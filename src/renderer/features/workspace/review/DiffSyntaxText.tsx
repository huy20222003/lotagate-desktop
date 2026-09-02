import type { ThemedToken } from 'shiki';
import { tokenStyle } from './file-syntax.js';

export function DiffSyntaxText({ text, tokens }: { text: string; tokens?: ThemedToken[] | undefined }) {
  if (tokens === undefined) return <>{text}</>;
  return <>{tokens.map((token, index) => <span key={`${index}:${token.content}`} style={tokenStyle(token, false)}>{token.content}</span>)}</>;
}
