import Markdown from 'react-markdown';
import { Children, cloneElement, isValidElement, type ReactNode } from 'react';
import remarkGfm from 'remark-gfm';
import { MarkdownCodeBlock } from './MarkdownCodeBlock.js';
import { MessageMarkup, type MessageFileReference } from './message-markup.js';
import { SafeLink } from './SafeLink.js';
import { protectNestedCodeFences } from './markdown-code-fences.js';

export function AgentMarkdown({ content, fileReferences = [], filePaths = [], workspaceCwd, executionCwd }: { content: string; fileReferences?: readonly MessageFileReference[]; filePaths?: readonly string[]; workspaceCwd?: string; executionCwd?: string }) {
  const references = [...fileReferences, ...filePaths.map(path => ({ path, name: fileName(path) }))];
  const renderText = (children: ReactNode) => renderMessageChildren(children, references, workspaceCwd, executionCwd);
  return <div className="agent-markdown"><Markdown remarkPlugins={[remarkGfm]} components={{ a: SafeLink, pre: MarkdownCodeBlock, p: ({ children }) => <p>{renderText(children)}</p>, li: ({ children }) => <li>{renderText(children)}</li>, h1: ({ children }) => <h1>{renderText(children)}</h1>, h2: ({ children }) => <h2>{renderText(children)}</h2>, h3: ({ children }) => <h3>{renderText(children)}</h3>, h4: ({ children }) => <h4>{renderText(children)}</h4>, h5: ({ children }) => <h5>{renderText(children)}</h5>, h6: ({ children }) => <h6>{renderText(children)}</h6>, blockquote: ({ children }) => <blockquote>{renderText(children)}</blockquote>, th: ({ children }) => <th>{renderText(children)}</th>, td: ({ children }) => <td>{renderText(children)}</td> }}>{protectNestedCodeFences(content)}</Markdown></div>;
}

function fileName(path: string): string { return path.split(/[\\/]/u).pop() ?? path; }

function renderMessageChildren(children: ReactNode, fileReferences: readonly MessageFileReference[], workspaceCwd?: string, executionCwd?: string): ReactNode {
  return Children.toArray(children).map((child, index) => {
    if (typeof child === 'string') return <MessageMarkup key={`message-text:${index}`} content={child} fileReferences={fileReferences} {...(workspaceCwd === undefined ? {} : { workspaceCwd })} {...(executionCwd === undefined ? {} : { executionCwd })} />;
    if (!isValidElement(child) || typeof child.type !== 'string' || child.props.children === undefined) return child;
    return cloneElement(child, { key: child.key ?? `message-node:${index}` }, renderMessageChildren(child.props.children, fileReferences, workspaceCwd, executionCwd));
  });
}
