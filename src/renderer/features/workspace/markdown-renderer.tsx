import type { AnchorHTMLAttributes, ReactElement, ReactNode } from 'react';
import { Children, isValidElement } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { CopyTextButton } from '../../components/ui.js';

export function AgentMarkdown({ content }: { content: string }) {
  return <div className="agent-markdown"><Markdown remarkPlugins={[remarkGfm]} components={{ a: SafeLink, pre: MarkdownCodeBlock }}>{content}</Markdown></div>;
}

function SafeLink({ href, children, ...props }: AnchorHTMLAttributes<HTMLAnchorElement>) {
  const safe = href !== undefined && /^https?:\/\//iu.test(href);
  return safe ? <a {...props} href={href} target="_blank" rel="noreferrer">{children}</a> : <span>{children}</span>;
}

type CodeElement = ReactElement<{ children?: ReactNode; className?: string }>;

function MarkdownCodeBlock({ children }: { children?: ReactNode }) {
  const code = isValidElement(children) ? children as CodeElement : undefined;
  const language = code?.props.className?.match(/language-([\w-]+)/u)?.[1] ?? 'Plain text';
  const content = textContent(code?.props.children ?? children).replace(/\n$/u, '');
  return <div className="markdown-code-block"><header><span>{language}</span><CopyTextButton content={content} label="Copy code" /></header><pre>{children}</pre></div>;
}

function textContent(value: ReactNode): string {
  return Children.toArray(value).map(child => {
    if (typeof child === 'string' || typeof child === 'number') return String(child);
    if (isValidElement(child)) return textContent(child.props.children as ReactNode);
    return '';
  }).join('');
}
