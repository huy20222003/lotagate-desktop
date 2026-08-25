import type { AnchorHTMLAttributes } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export function AgentMarkdown({ content }: { content: string }) {
  return <Markdown remarkPlugins={[remarkGfm]} components={{ a: SafeLink }}>{content}</Markdown>;
}

function SafeLink({ href, children, ...props }: AnchorHTMLAttributes<HTMLAnchorElement>) {
  const safe = href !== undefined && /^https?:\/\//iu.test(href);
  return safe ? <a {...props} href={href} target="_blank" rel="noreferrer">{children}</a> : <span>{children}</span>;
}
