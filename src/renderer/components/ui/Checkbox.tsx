import { useId } from 'react';
import * as CheckboxPrimitive from '@radix-ui/react-checkbox';
import { Check } from 'lucide-react';
import { cn } from '../../utils/cn.js';

export function Checkbox({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  const id = useId();
  return <label htmlFor={id} className={cn('check-control', 'ui-check-control')}><CheckboxPrimitive.Root id={id} className="ui-checkbox-root" checked={checked} onCheckedChange={value => onChange(value === true)}><CheckboxPrimitive.Indicator><Check size={12} strokeWidth={3} /></CheckboxPrimitive.Indicator></CheckboxPrimitive.Root><span>{label}</span></label>;
}
