import type { AnchorHTMLAttributes } from 'react';
import { MessageExternalLink, parseExternalUrl } from './message-markup.js';

export function SafeLink({ href, children }: AnchorHTMLAttributes<HTMLAnchorElement>) {
  const normalized = href === undefined ? undefined : parseExternalUrl(href);
  return normalized === undefined ? <span>{children}</span> : <MessageExternalLink href={normalized.toString()} children={children} />;
}
