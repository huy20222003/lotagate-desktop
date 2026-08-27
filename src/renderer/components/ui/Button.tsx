import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '../../utils/cn.js';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }>(({ variant = 'secondary', className = '', ...props }, ref) => <button ref={ref} className={cn('button', `button-${variant}`, 'ui-button', `ui-button-${variant}`, className)} {...props} />);
Button.displayName = 'Button';
