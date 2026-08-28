import Markdown from 'react-markdown';
import type { ReactNode } from 'react';
import { Children } from 'react';
import remarkGfm from 'remark-gfm';
import { MarkdownCodeBlock } from './MarkdownCodeBlock.js';
import { SafeLink } from './SafeLink.js';

export function AgentMarkdown({ content, filePaths = [] }: { content: string; filePaths?: readonly string[] }) {
  return <div className="agent-markdown"><Markdown remarkPlugins={[remarkGfm]} components={{ a: SafeLink, pre: MarkdownCodeBlock, p: ({ children }) => <p>{renderFilePathChildren(children, filePaths)}</p> }}>{content}</Markdown></div>;
}

function renderFilePathChildren(children: ReactNode, filePaths: readonly string[]): ReactNode {
  return Children.toArray(children).flatMap(child => typeof child === 'string' ? linkifyFilePaths(child, filePaths) : [child]);
}

function linkifyFilePaths(content: string, filePaths: readonly string[]): ReactNode[] {
  const paths = [...new Set(filePaths)].filter(path => path.length > 0).sort((left, right) => right.length - left.length);
  const result: ReactNode[] = [];
  let cursor = 0;
  while (cursor < content.length) {
    const match = paths.map(path => ({ path, index: content.indexOf(path, cursor) })).filter(item => item.index >= 0).sort((left, right) => left.index - right.index || right.path.length - left.path.length)[0];
    if (match === undefined) { result.push(content.slice(cursor)); break; }
    if (match.index > cursor) result.push(content.slice(cursor, match.index));
    result.push(<a key={`${match.path}:${match.index}`} className="agent-file-path" href="#reveal-file" onClick={event => { event.preventDefault(); void window.lotagate.operations.revealPath(match.path).catch(() => undefined); }}>{match.path}</a>);
    cursor = match.index + match.path.length;
  }
  return result;
}
