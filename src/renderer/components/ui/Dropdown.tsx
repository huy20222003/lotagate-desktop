import { useState } from 'react';
import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu';
import { Check, ChevronDown } from 'lucide-react';
import { Scrollbar } from '../Scrollbar.js';
import { cn } from '../../utils/cn.js';
import { Label } from './Label.js';

export interface DropdownOption { value: string; label: string }
export function Dropdown({ label, ariaLabel, value, options, onChange, disabled = false, className = '' }: { label?: string; ariaLabel?: string; value: string; options: DropdownOption[]; onChange: (value: string) => void; disabled?: boolean; className?: string }) {
  const [open, setOpen] = useState(false);
  const selected = options.find(option => option.value === value)?.label ?? value;
  const hasSelectedValue = options.some(option => option.value === value);
  return <DropdownMenuPrimitive.Root open={open} onOpenChange={setOpen}><div className={cn('dropdown', open ? 'open' : '', className)}>{label ? <Label>{label}</Label> : null}<DropdownMenuPrimitive.Trigger asChild><button type="button" className={cn('model-select', 'ui-select-trigger')} aria-label={ariaLabel ?? label ?? 'Select option'} disabled={disabled}><span>{selected}</span><ChevronDown size={14} /></button></DropdownMenuPrimitive.Trigger></div><DropdownMenuPrimitive.Portal><DropdownMenuPrimitive.Content className={cn('dropdown-menu', 'ui-menu-content')} align="start" side="bottom" sideOffset={8} avoidCollisions collisionPadding={8}><Scrollbar className="dropdown-scrollbar"><DropdownMenuPrimitive.RadioGroup {...(hasSelectedValue ? { value } : {})} onValueChange={onChange}>{options.map(option => <DropdownMenuPrimitive.RadioItem className={cn('dropdown-option', 'ui-menu-item')} value={option.value} key={option.value}><DropdownMenuPrimitive.ItemIndicator className="ui-menu-indicator"><Check size={13} /></DropdownMenuPrimitive.ItemIndicator>{option.label}</DropdownMenuPrimitive.RadioItem>)}</DropdownMenuPrimitive.RadioGroup></Scrollbar></DropdownMenuPrimitive.Content></DropdownMenuPrimitive.Portal></DropdownMenuPrimitive.Root>;
}
