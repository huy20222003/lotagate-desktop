import * as TabsPrimitive from '@radix-ui/react-tabs';
import { X } from 'lucide-react';
import { cn } from '../../utils/cn.js';
import { IconButton } from './IconButton.js';

export interface TabItem { value: string; label: string }
export function Tabs({ value, items, onChange, onClose, ariaLabel = 'Views' }: { value: string; items: TabItem[]; onChange: (value: string) => void; onClose?: (value: string) => void; ariaLabel?: string }) {
  return <TabsPrimitive.Root value={value} onValueChange={onChange}><TabsPrimitive.List className={cn('tabs', 'ui-tabs')} aria-label={ariaLabel}>{items.map(item => <span className="tab-item" key={item.value}><TabsPrimitive.Trigger type="button" value={item.value} className={cn('tab', 'ui-tab')}><span>{item.label}</span></TabsPrimitive.Trigger>{onClose ? <IconButton icon={X} iconSize={12} className="tab-close" label={`Close ${item.label}`} onClick={() => onClose(item.value)} /> : null}</span>)}</TabsPrimitive.List></TabsPrimitive.Root>;
}
