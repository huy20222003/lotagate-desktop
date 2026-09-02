import type { AnchorHTMLAttributes } from 'react';
import { MessageExternalLink } from './message-markup.js';

export function SafeLink({ href, children }: AnchorHTMLAttributes<HTMLAnchorElement>) {
  const safe = href !== undefined && /^https?:\/\//iu.test(href);
  return safe ? <MessageExternalLink href={href} children={children} /> : <span>{children}</span>;
}
