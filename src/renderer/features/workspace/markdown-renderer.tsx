import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { MarkdownCodeBlock } from './MarkdownCodeBlock.js';
import { SafeLink } from './SafeLink.js';

export function AgentMarkdown({ content }: { content: string }) {
  return <div className="agent-markdown"><Markdown remarkPlugins={[remarkGfm]} components={{ a: SafeLink, pre: MarkdownCodeBlock }}>{content}</Markdown></div>;
}
