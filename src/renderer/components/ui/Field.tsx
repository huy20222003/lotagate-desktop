import type { ReactNode } from 'react';
import { cn } from '../../utils/cn.js';
import { Label } from './Label.js';

export function Field({ label, children, error, required = false, require = false }: { label: ReactNode; children: ReactNode; error?: string | undefined; required?: boolean | undefined; require?: boolean | undefined }) {
  return <label className="field"><Label required={required} require={require}>{label}</Label>{children}{error ? <span className={cn('field-error', 'ui-field-error')} role="alert">{error}</span> : null}</label>;
}
