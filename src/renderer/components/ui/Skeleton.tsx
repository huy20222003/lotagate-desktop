import { forwardRef, type HTMLAttributes } from 'react';
import { cn } from '../../utils/cn.js';

export const Skeleton = forwardRef<HTMLSpanElement, HTMLAttributes<HTMLSpanElement>>(({ children, className = '', ...props }, ref) => <span ref={ref} className={cn('skeleton', 'ui-skeleton', className)} aria-hidden="true" {...props}>{children}</span>);
Skeleton.displayName = 'Skeleton';
