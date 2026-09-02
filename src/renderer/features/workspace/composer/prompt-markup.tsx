import type { ReactNode } from 'react';

const PROMPT_TOKEN_PATTERN = /(@[^\s]+|https?:\/\/[^\s]+|\/[A-Za-z0-9][^\s]*)/gu;
const PROMPT_TOKEN_EXACT_PATTERN = /^(@[^\s]+|https?:\/\/[^\s]+|\/[A-Za-z0-9][^\s]*)$/u;

export function PromptMarkup({ content }: { content: string }): ReactNode {
  const parts = content.split(PROMPT_TOKEN_PATTERN);
  return <>{parts.map((part, index) => PROMPT_TOKEN_EXACT_PATTERN.test(part) ? <span className="prompt-token" key={`${part}-${index}`}>{part}</span> : <span key={`${index}`}>{part}</span>)}</>;
}
