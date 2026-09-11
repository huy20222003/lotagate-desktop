import Markdown from 'react-markdown';
import { Children, cloneElement, isValidElement, useMemo, type ReactNode } from 'react';
import remarkGfm from 'remark-gfm';
import { MarkdownCodeBlock } from './MarkdownCodeBlock.js';
import { MessageMarkup, type MessageFileReference } from './message-markup.js';
import { SafeLink } from './SafeLink.js';
import { protectNestedCodeFences } from './markdown-code-fences.js';

const REMARK_PLUGINS = [remarkGfm];

export function AgentMarkdown({ content, fileReferences = [], filePaths = [], workspaceCwd, executionCwd }: { content: string; fileReferences?: readonly MessageFileReference[]; filePaths?: readonly string[]; workspaceCwd?: string; executionCwd?: string }) {
  const references = useMemo(() => [...fileReferences, ...filePaths.map(path => ({ path, name: fileName(path) }))], [filePaths, fileReferences]);
  const components = useMemo(() => {
    const renderText = (children: ReactNode) => renderMessageChildren(children, references, workspaceCwd, executionCwd);
    return {
      a: SafeLink,
      pre: MarkdownCodeBlock,
      p: ({ children }: { children?: ReactNode }) => <p>{renderText(children)}</p>,
      li: ({ children }: { children?: ReactNode }) => <li>{renderText(children)}</li>,
      h1: ({ children }: { children?: ReactNode }) => <h1>{renderText(children)}</h1>,
      h2: ({ children }: { children?: ReactNode }) => <h2>{renderText(children)}</h2>,
      h3: ({ children }: { children?: ReactNode }) => <h3>{renderText(children)}</h3>,
      h4: ({ children }: { children?: ReactNode }) => <h4>{renderText(children)}</h4>,
      h5: ({ children }: { children?: ReactNode }) => <h5>{renderText(children)}</h5>,
      h6: ({ children }: { children?: ReactNode }) => <h6>{renderText(children)}</h6>,
      blockquote: ({ children }: { children?: ReactNode }) => <blockquote>{renderText(children)}</blockquote>,
      th: ({ children }: { children?: ReactNode }) => <th>{renderText(children)}</th>,
      td: ({ children }: { children?: ReactNode }) => <td>{renderText(children)}</td>,
    };
  }, [executionCwd, references, workspaceCwd]);
  return <div className="agent-markdown"><Markdown remarkPlugins={REMARK_PLUGINS} components={components}>{protectNestedCodeFences(content)}</Markdown></div>;
}

function fileName(path: string): string { return path.split(/[\\/]/u).pop() ?? path; }

function renderMessageChildren(children: ReactNode, fileReferences: readonly MessageFileReference[], workspaceCwd?: string, executionCwd?: string): ReactNode {
  return Children.toArray(children).map((child, index) => {
    if (typeof child === 'string') return <MessageMarkup key={`message-text:${index}`} content={child} fileReferences={fileReferences} {...(workspaceCwd === undefined ? {} : { workspaceCwd })} {...(executionCwd === undefined ? {} : { executionCwd })} />;
    if (!isValidElement(child) || typeof child.type !== 'string' || child.props.children === undefined) return child;
    return cloneElement(child, { key: child.key ?? `message-node:${index}` }, renderMessageChildren(child.props.children, fileReferences, workspaceCwd, executionCwd));
  });
}
