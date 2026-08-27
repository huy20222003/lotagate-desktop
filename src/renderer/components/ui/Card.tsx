import type { PropsWithChildren } from 'react';
import { cn } from '../../utils/cn.js';

export function Card({ children, className = '' }: PropsWithChildren<{ className?: string }>) {
  return <section className={cn('card', 'ui-card', className)}>{children}</section>;
}
