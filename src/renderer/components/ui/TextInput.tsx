import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from 'react';
import { cn } from '../../utils/cn.js';
import { Label } from './Label.js';

export type TextInputProps = InputHTMLAttributes<HTMLInputElement> & { label?: ReactNode; errorText?: string; require?: boolean };
export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(function TextInput({ className = '', label, errorText, require = false, required = false, 'aria-describedby': describedBy, ...props }, ref) {
  const errorId = useId();
  const labelId = useId();
  const isRequired = required || require;
  const describedByValue = [describedBy, errorText ? errorId : undefined].filter(Boolean).join(' ') || undefined;
  const input = <input ref={ref} className={cn('text-input', 'ui-input', errorText ? 'has-error' : '', className)} required={isRequired} aria-invalid={errorText ? true : undefined} aria-describedby={describedByValue} aria-labelledby={label === undefined ? undefined : labelId} {...props} />;
  if (label === undefined && errorText === undefined) return input;
  return <div className="input-control">{label !== undefined ? <Label id={labelId} required={isRequired}>{label}</Label> : null}{input}{errorText ? <span id={errorId} className={cn('field-error', 'ui-field-error')} role="alert">{errorText}</span> : null}</div>;
});
TextInput.displayName = 'TextInput';
