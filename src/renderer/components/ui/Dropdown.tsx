import { useState } from 'react';
import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu';
import { Check, ChevronDown } from 'lucide-react';
import { Scrollbar } from '../Scrollbar.js';
import { cn } from '../../utils/cn.js';
import { Label } from './Label.js';
import { Icon } from './Icon.js';

export interface DropdownOption { value: string; label: string }
interface DropdownBaseProps { label?: string; ariaLabel?: string; options: DropdownOption[]; disabled?: boolean; className?: string; placeholder?: string }
interface SingleDropdownProps extends DropdownBaseProps { multiple?: false; value: string; onChange: (value: string) => void }
interface MultiDropdownProps extends DropdownBaseProps { multiple: true; value: string[]; onChange: (value: string[]) => void }
export type DropdownProps = SingleDropdownProps | MultiDropdownProps;

export function Dropdown(props: DropdownProps) {
  const { label, ariaLabel, options, disabled = false, className = '', placeholder } = props;
  const [open, setOpen] = useState(false);
  const multiple = props.multiple === true;
  const selectedValues: string[] = props.multiple === true ? props.value : [props.value];
  const singleValue = props.multiple === true ? '' : props.value;
  const selectedLabels = options.filter(option => selectedValues.includes(option.value)).map(option => option.label);
  const singleSelected = options.find(option => option.value === singleValue)?.label ?? singleValue;
  const selected = multiple
    ? selectedLabels.join(', ') || placeholder || 'Select options'
    : singleSelected || placeholder || 'Select option';
  const hasSelectedValue = options.some(option => option.value === singleValue);
  const toggleValue = (nextValue: string) => {
    if (props.multiple === true) {
      props.onChange(selectedValues.includes(nextValue) ? selectedValues.filter(item => item !== nextValue) : [...selectedValues, nextValue]);
      return;
    }
    props.onChange(nextValue);
  };
  const items = options.map(option => multiple
    ? <DropdownMenuPrimitive.CheckboxItem className={cn('dropdown-option', 'ui-menu-item')} checked={selectedValues.includes(option.value)} onSelect={event => { event.preventDefault(); toggleValue(option.value); }} key={option.value}><DropdownMenuPrimitive.ItemIndicator className="ui-menu-indicator"><Icon icon={Check} size={13} /></DropdownMenuPrimitive.ItemIndicator>{option.label}</DropdownMenuPrimitive.CheckboxItem>
    : <DropdownMenuPrimitive.RadioItem className={cn('dropdown-option', 'ui-menu-item')} value={option.value} key={option.value}><DropdownMenuPrimitive.ItemIndicator className="ui-menu-indicator"><Icon icon={Check} size={13} /></DropdownMenuPrimitive.ItemIndicator>{option.label}</DropdownMenuPrimitive.RadioItem>);
  const content = options.length === 0
    ? <DropdownMenuPrimitive.Item className={cn('dropdown-empty', 'ui-menu-item')} disabled>No item to select</DropdownMenuPrimitive.Item>
    : multiple ? items : <DropdownMenuPrimitive.RadioGroup {...(hasSelectedValue ? { value: singleValue } : {})} onValueChange={toggleValue}>{items}</DropdownMenuPrimitive.RadioGroup>;
  return <DropdownMenuPrimitive.Root open={open} onOpenChange={setOpen}><div className={cn('dropdown', open ? 'open' : '', className)}>{label ? <Label>{label}</Label> : null}<DropdownMenuPrimitive.Trigger asChild><button type="button" className={cn('model-select', 'ui-select-trigger')} aria-label={ariaLabel ?? label ?? 'Select option'} disabled={disabled}><span>{selected}</span><Icon icon={ChevronDown} size={14} /></button></DropdownMenuPrimitive.Trigger></div><DropdownMenuPrimitive.Portal><DropdownMenuPrimitive.Content className={cn('dropdown-menu', 'ui-menu-content')} align="start" side="bottom" sideOffset={8} avoidCollisions collisionPadding={8}><Scrollbar className="dropdown-scrollbar">{content}</Scrollbar></DropdownMenuPrimitive.Content></DropdownMenuPrimitive.Portal></DropdownMenuPrimitive.Root>;
}
