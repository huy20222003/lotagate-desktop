import { useId } from 'react';
import { cn } from '../../utils/cn.js';

export function Radio({ label, checked, onChange }: { label: string; checked: boolean; onChange: () => void }) {
  const id = useId();
  return <label htmlFor={id} className={cn('check-control', 'ui-check-control')}><input id={id} className="ui-radio" type="radio" checked={checked} onChange={onChange} /> <span>{label}</span></label>;
}
