import type { PropsWithChildren } from 'react';
import { cn } from '../../utils/cn.js';

export type FormControlLabelProps = PropsWithChildren<{ required?: boolean; require?: boolean; className?: string; id?: string }>;
export function Label({ children, required = false, require = false, className = '', id }: FormControlLabelProps) {
  return <span id={id} className={cn('field-label', 'ui-label', className)}>{children}{required || require ? <span className="field-required" aria-hidden="true">*</span> : null}</span>;
}
