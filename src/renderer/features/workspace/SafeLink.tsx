import type { AnchorHTMLAttributes } from 'react';

export function SafeLink({ href, children, ...props }: AnchorHTMLAttributes<HTMLAnchorElement>) {
  const safe = href !== undefined && /^https?:\/\//iu.test(href);
  return safe ? <a {...props} href={href} target="_blank" rel="noreferrer">{children}</a> : <span>{children}</span>;
}
