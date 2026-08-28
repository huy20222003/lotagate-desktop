import { forwardRef, type ButtonHTMLAttributes } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '../../utils/cn.js';
import { Icon } from './Icon.js';
import { Tooltip } from './Tooltip.js';

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label' | 'children'> {
  icon: LucideIcon;
  label: string;
  tooltip?: string | false;
  iconSize?: number;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(({ icon, label, tooltip = label, iconSize = 16, className = '', type = 'button', ...props }, ref) => {
  const button = <button ref={ref} type={type} className={cn('icon-button', 'ui-icon-button', className)} aria-label={label} {...props}><Icon icon={icon} size={iconSize} /></button>;
  return tooltip === false ? button : <Tooltip label={tooltip}>{button}</Tooltip>;
});
IconButton.displayName = 'IconButton';
