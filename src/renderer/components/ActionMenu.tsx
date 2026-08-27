import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu';
import { MoreHorizontal } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '../utils/cn.js';

export interface ActionMenuItem {
  label: string;
  icon: LucideIcon;
  onSelect: () => void;
  tone?: 'default' | 'danger';
  disabled?: boolean;
}

export function ActionMenu({ items, ariaLabel = 'More actions', className = '', header }: { items: readonly ActionMenuItem[]; ariaLabel?: string; className?: string; header?: ReactNode }) {
  return <DropdownMenuPrimitive.Root>
    <DropdownMenuPrimitive.Trigger asChild>
      <button type="button" className={cn('action-menu-trigger', className)} aria-label={ariaLabel}><MoreHorizontal size={15} /></button>
    </DropdownMenuPrimitive.Trigger>
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content className="action-menu-content" align="end" sideOffset={6} collisionPadding={8}>
        {header ? <div className="action-menu-header">{header}</div> : null}
        {items.map(item => <DropdownMenuPrimitive.Item key={item.label} className={cn('action-menu-item', item.tone === 'danger' ? 'action-menu-item-danger' : '')} {...(item.disabled === undefined ? {} : { disabled: item.disabled })} onSelect={item.onSelect}><item.icon size={14} /> <span>{item.label}</span></DropdownMenuPrimitive.Item>)}
      </DropdownMenuPrimitive.Content>
    </DropdownMenuPrimitive.Portal>
  </DropdownMenuPrimitive.Root>;
}
