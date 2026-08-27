import type { PropsWithChildren } from 'react';
import { cn } from '../../utils/cn.js';

export function Badge({ children, tone = 'neutral', size = 'sm', className = '' }: PropsWithChildren<{ tone?: 'neutral' | 'success' | 'warning' | 'danger'; size?: 'sm' | 'md'; className?: string }>) {
  return <span className={cn('badge', `badge-${tone}`, `badge-${size}`, 'ui-badge', `ui-badge-${tone}`, className)}>{children}</span>;
}
