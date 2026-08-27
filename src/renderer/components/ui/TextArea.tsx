import { forwardRef, useId, type ReactNode, type TextareaHTMLAttributes } from 'react';
import { cn } from '../../utils/cn.js';
import { Label } from './Label.js';

export type TextAreaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & { label?: ReactNode; errorText?: string; require?: boolean };
export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(({ className = '', label, errorText, require = false, required = false, 'aria-describedby': describedBy, ...props }, ref) => {
  const errorId = useId();
  const labelId = useId();
  const isRequired = required || require;
  const describedByValue = [describedBy, errorText ? errorId : undefined].filter(Boolean).join(' ') || undefined;
  const textarea = <textarea ref={ref} className={cn('text-input', 'text-area', 'ui-input', errorText ? 'has-error' : '', className)} required={isRequired} aria-invalid={errorText ? true : undefined} aria-describedby={describedByValue} aria-labelledby={label === undefined ? undefined : labelId} {...props} />;
  if (label === undefined && errorText === undefined) return textarea;
  return <div className="input-control">{label !== undefined ? <Label id={labelId} required={isRequired}>{label}</Label> : null}{textarea}{errorText ? <span id={errorId} className={cn('field-error', 'ui-field-error')} role="alert">{errorText}</span> : null}</div>;
});
TextArea.displayName = 'TextArea';
