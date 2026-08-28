import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '../../utils/cn.js';
import { Tooltip } from './Tooltip.js';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; tooltip?: string };
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(({ variant = 'secondary', className = '', tooltip, children, 'aria-label': ariaLabel, ...props }, ref) => {
  const button = <button ref={ref} className={cn('button', `button-${variant}`, 'ui-button', `ui-button-${variant}`, className)} aria-label={ariaLabel} {...props}>{children}</button>;
  const tooltipLabel = tooltip ?? (typeof ariaLabel === 'string' ? ariaLabel : undefined);
  return tooltipLabel === undefined ? button : <Tooltip label={tooltipLabel}>{button}</Tooltip>;
});
Button.displayName = 'Button';
