import Markdown from 'react-markdown';
import { Children, cloneElement, isValidElement, type ReactNode } from 'react';
import remarkGfm from 'remark-gfm';
import { MarkdownCodeBlock } from './MarkdownCodeBlock.js';
import { MessageMarkup, type MessageFileReference } from './message-markup.js';
import { SafeLink } from './SafeLink.js';

export function AgentMarkdown({ content, fileReferences = [], filePaths = [], workspaceCwd }: { content: string; fileReferences?: readonly MessageFileReference[]; filePaths?: readonly string[]; workspaceCwd?: string }) {
  const references = [...fileReferences, ...filePaths.map(path => ({ path, name: fileName(path) }))];
  return <div className="agent-markdown"><Markdown remarkPlugins={[remarkGfm]} components={{ a: SafeLink, pre: MarkdownCodeBlock, p: ({ children }) => <p>{renderMessageChildren(children, references, workspaceCwd)}</p>, li: ({ children }) => <li>{renderMessageChildren(children, references, workspaceCwd)}</li> }}>{content}</Markdown></div>;
}

function fileName(path: string): string { return path.split(/[\\/]/u).pop() ?? path; }

function renderMessageChildren(children: ReactNode, fileReferences: readonly MessageFileReference[], workspaceCwd?: string): ReactNode {
  return Children.toArray(children).map((child, index) => {
    if (typeof child === 'string') return <MessageMarkup key={`message-text:${index}`} content={child} fileReferences={fileReferences} {...(workspaceCwd === undefined ? {} : { workspaceCwd })} />;
    if (!isValidElement(child) || typeof child.type !== 'string' || child.props.children === undefined) return child;
    return cloneElement(child, { key: child.key ?? `message-node:${index}` }, renderMessageChildren(child.props.children, fileReferences, workspaceCwd));
  });
}
