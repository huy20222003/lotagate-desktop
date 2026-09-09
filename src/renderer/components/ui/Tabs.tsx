import * as TabsPrimitive from '@radix-ui/react-tabs';
import { X, type LucideIcon } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { cn } from '../../utils/cn.js';
import { IconButton } from './IconButton.js';
import { Icon } from './Icon.js';

export interface TabItem { value: string; label: string; icon?: LucideIcon }
export function Tabs({ value, items, onChange, onClose, closeActiveOnly = false, ariaLabel = 'Views' }: { value: string; items: TabItem[]; onChange: (value: string) => void; onClose?: (value: string) => void; closeActiveOnly?: boolean; ariaLabel?: string }) {
  const tabRefs = useRef(new Map<string, HTMLSpanElement>());
  useEffect(() => { tabRefs.current.get(value)?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' }); }, [value]);
  return <TabsPrimitive.Root value={value} onValueChange={onChange}><TabsPrimitive.List className={cn('tabs', 'ui-tabs')} aria-label={ariaLabel}>{items.map(item => <span ref={element => { if (element) tabRefs.current.set(item.value, element); else tabRefs.current.delete(item.value); }} className="tab-item" key={item.value}><TabsPrimitive.Trigger type="button" value={item.value} className={cn('tab', 'ui-tab')}>{item.icon ? <Icon icon={item.icon} size={14} /> : null}<span className="tab-label">{item.label}</span></TabsPrimitive.Trigger>{onClose && (!closeActiveOnly || item.value === value) ? <IconButton icon={X} iconSize={12} className="tab-close" label={`Close ${item.label}`} onClick={() => onClose(item.value)} /> : null}</span>)}</TabsPrimitive.List></TabsPrimitive.Root>;
}
