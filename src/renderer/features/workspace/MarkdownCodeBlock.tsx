import type { ReactElement, ReactNode } from 'react';
import { Children, isValidElement } from 'react';
import { CopyTextButton } from '../../components/ui.js';
import { Scrollbar } from '../../components/Scrollbar.js';
import { restoreProtectedCodeFences } from './markdown-code-fences.js';

type CodeElement = ReactElement<{ children?: ReactNode; className?: string }>;

export function MarkdownCodeBlock({ children }: { children?: ReactNode }) {
  const code = isValidElement(children) ? children as CodeElement : undefined;
  const language = code?.props.className?.match(/language-([\w-]+)/u)?.[1] ?? 'Plain text';
  const content = restoreProtectedCodeFences(textContent(code?.props.children ?? children)).replace(/\n$/u, '');
  return <div className="markdown-code-block"><header><span>{language}</span><CopyTextButton content={content} label="Copy code" /></header><Scrollbar className="markdown-code-scroll"><pre>{content}</pre></Scrollbar></div>;
}

function textContent(value: ReactNode): string {
  return Children.toArray(value).map(child => { if (typeof child === 'string' || typeof child === 'number') return String(child); if (isValidElement(child)) return textContent(child.props.children as ReactNode); return ''; }).join('');
}
