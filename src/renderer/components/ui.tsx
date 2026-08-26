import type { ButtonHTMLAttributes, HTMLAttributes, InputHTMLAttributes, PropsWithChildren, ReactElement, ReactNode, TextareaHTMLAttributes } from 'react';
import { createContext, forwardRef, useCallback, useContext, useEffect, useId, useState } from 'react';
import * as CheckboxPrimitive from '@radix-ui/react-checkbox';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { Check, CheckCircle2, ChevronDown, Copy, Info, X, XCircle } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useClipboard } from '../hooks/use-clipboard.js';
import { cn } from '../utils/cn.js';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }>(({ variant = 'secondary', className = '', ...props }, ref) => {
  return <button ref={ref} className={cn('button', `button-${variant}`, 'ui-button', `ui-button-${variant}`, className)} {...props} />;
});
Button.displayName = 'Button';

export function Icon({ icon: IconComponent, size = 16, label, ...props }: { icon: LucideIcon; size?: number; label?: string; className?: string }) {
  return <IconComponent size={size} aria-hidden={label === undefined} aria-label={label} {...props} />;
}

type FormControlLabelProps = PropsWithChildren<{ required?: boolean; require?: boolean; className?: string; id?: string }>;

export function Label({ children, required = false, require = false, className = '', id }: FormControlLabelProps) {
  return <span id={id} className={cn('field-label', 'ui-label', className)}>{children}{required || require ? <span className="field-required" aria-hidden="true">*</span> : null}</span>;
}

type TextInputProps = InputHTMLAttributes<HTMLInputElement> & { label?: ReactNode; errorText?: string; require?: boolean };
export function TextInput({ className = '', label, errorText, require = false, required = false, 'aria-describedby': describedBy, ...props }: TextInputProps) {
  const errorId = useId();
  const labelId = useId();
  const isRequired = required || require;
  const describedByValue = [describedBy, errorText ? errorId : undefined].filter(Boolean).join(' ') || undefined;
  const input = <input className={cn('text-input', 'ui-input', errorText ? 'has-error' : '', className)} required={isRequired} aria-invalid={errorText ? true : undefined} aria-describedby={describedByValue} aria-labelledby={label === undefined ? undefined : labelId} {...props} />;
  if (label === undefined && errorText === undefined) return input;
  return <div className="input-control">{label !== undefined ? <Label id={labelId} required={isRequired}>{label}</Label> : null}{input}{errorText ? <span id={errorId} className={cn('field-error', 'ui-field-error')} role="alert">{errorText}</span> : null}</div>;
}

type TextAreaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & { label?: ReactNode; errorText?: string; require?: boolean };
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

export function Checkbox({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  const id = useId();
  return <label htmlFor={id} className={cn('check-control', 'ui-check-control')}><CheckboxPrimitive.Root id={id} className="ui-checkbox-root" checked={checked} onCheckedChange={value => onChange(value === true)}><CheckboxPrimitive.Indicator><Check size={12} strokeWidth={3} /></CheckboxPrimitive.Indicator></CheckboxPrimitive.Root><span>{label}</span></label>;
}

export function Radio({ label, checked, onChange }: { label: string; checked: boolean; onChange: () => void }) {
  const id = useId();
  return <label htmlFor={id} className={cn('check-control', 'ui-check-control')}><input id={id} className="ui-radio" type="radio" checked={checked} onChange={onChange} /> <span>{label}</span></label>;
}

export function Badge({ children, tone = 'neutral', size = 'sm', className = '' }: PropsWithChildren<{ tone?: 'neutral' | 'success' | 'warning' | 'danger'; size?: 'sm' | 'md'; className?: string }>) {
  return <span className={cn('badge', `badge-${tone}`, `badge-${size}`, 'ui-badge', `ui-badge-${tone}`, className)}>{children}</span>;
}

export function Card({ children, className = '' }: PropsWithChildren<{ className?: string }>) {
  return <section className={cn('card', 'ui-card', className)}>{children}</section>;
}

export function Divider() { return <hr className="divider" />; }

export function EmptyState({ title, detail, action }: { title: string; detail?: string; action?: ReactNode }) {
  return <div className="empty-state"><strong>{title}</strong>{detail ? <p>{detail}</p> : null}{action}</div>;
}

export function Tooltip({ label, children }: { label: string; children: ReactElement }) {
  return <TooltipPrimitive.Provider delayDuration={0}><TooltipPrimitive.Root><TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger><TooltipPrimitive.Portal><TooltipPrimitive.Content className="ui-tooltip-content" sideOffset={7}>{label}</TooltipPrimitive.Content></TooltipPrimitive.Portal></TooltipPrimitive.Root></TooltipPrimitive.Provider>;
}

export const Skeleton = forwardRef<HTMLSpanElement, HTMLAttributes<HTMLSpanElement>>(({ children, className = '', ...props }, ref) => <span ref={ref} className={cn('skeleton', 'ui-skeleton', className)} aria-hidden="true" {...props}>{children}</span>);
Skeleton.displayName = 'Skeleton';

export function CopyTextButton({ content, label }: { content: string; label: string }) {
  const { copy, status } = useClipboard();
  const copied = status === 'copied';
  const tooltipLabel = status === 'error' ? 'Copy failed' : copied ? 'Copied' : label;
  return <Tooltip label={tooltipLabel}><button type="button" className={cn('agent-copy-button', 'icon-button', 'ui-icon-button')} aria-label={label} onClick={() => void copy(content)}>{copied ? <Check size={13} /> : <Copy size={13} />}</button></Tooltip>;
}

export function Dropdown({ label, value, options, onChange, disabled = false, className = '' }: { label?: string; value: string; options: Array<{ value: string; label: string }>; onChange: (value: string) => void; disabled?: boolean; className?: string }) {
  const [open, setOpen] = useState(false);
  const selected = options.find(option => option.value === value)?.label ?? value;
  const hasSelectedValue = options.some(option => option.value === value);
  return <DropdownMenuPrimitive.Root open={open} onOpenChange={setOpen}><div className={cn('dropdown', open ? 'open' : '', className)}>{label ? <Label>{label}</Label> : null}<DropdownMenuPrimitive.Trigger asChild><button type="button" className={cn('model-select', 'ui-select-trigger')} aria-label={label ?? 'Select option'} disabled={disabled}><span>{selected}</span><ChevronDown size={14} /></button></DropdownMenuPrimitive.Trigger></div><DropdownMenuPrimitive.Portal><DropdownMenuPrimitive.Content className={cn('dropdown-menu', 'ui-menu-content')} align="start" sideOffset={8} avoidCollisions><DropdownMenuPrimitive.RadioGroup {...(hasSelectedValue ? { value } : {})} onValueChange={onChange}>{options.map(option => <DropdownMenuPrimitive.RadioItem className={cn('dropdown-option', 'ui-menu-item')} value={option.value} key={option.value}><DropdownMenuPrimitive.ItemIndicator className="ui-menu-indicator"><Check size={13} /></DropdownMenuPrimitive.ItemIndicator>{option.label}</DropdownMenuPrimitive.RadioItem>)}</DropdownMenuPrimitive.RadioGroup></DropdownMenuPrimitive.Content></DropdownMenuPrimitive.Portal></DropdownMenuPrimitive.Root>;
}

export function Tabs({ value, items, onChange }: { value: string; items: Array<{ value: string; label: string }>; onChange: (value: string) => void }) {
  return <TabsPrimitive.Root value={value} onValueChange={onChange}><TabsPrimitive.List className={cn('tabs', 'ui-tabs')} aria-label="Views">{items.map(item => <TabsPrimitive.Trigger type="button" key={item.value} value={item.value} className={cn('tab', 'ui-tab')}><span>{item.label}</span></TabsPrimitive.Trigger>)}</TabsPrimitive.List></TabsPrimitive.Root>;
}

export function Table<T extends { id: string }>({ columns, rows }: { columns: Array<{ key: string; label: string; render?: (row: T) => ReactNode }>; rows: T[] }) {
  return <div className="table-wrap"><table><thead><tr>{columns.map(column => <th key={column.key} scope="col">{column.label}</th>)}</tr></thead><tbody>{rows.map(row => <tr key={row.id}>{columns.map(column => <td key={column.key}>{column.render ? column.render(row) : String((row as Record<string, unknown>)[column.key] ?? '')}</td>)}</tr>)}</tbody></table></div>;
}

export function Modal({ title, subtitle, children, onClose, className = '' }: PropsWithChildren<{ title: string; subtitle?: string; onClose: () => void; className?: string }>) {
  return <DialogPrimitive.Root open onOpenChange={open => { if (!open) onClose(); }}><DialogPrimitive.Portal><DialogPrimitive.Overlay className={cn('modal-backdrop', 'ui-dialog-overlay')} /><DialogPrimitive.Content className={cn('modal', 'ui-dialog-content', className)} onPointerDownOutside={event => event.preventDefault()}><header className="modal-header"><div className="modal-heading"><DialogPrimitive.Title asChild><h2>{title}</h2></DialogPrimitive.Title>{subtitle ? <DialogPrimitive.Description asChild><span className="modal-subtitle">{subtitle}</span></DialogPrimitive.Description> : null}</div><button type="button" className={cn('icon-button', 'ui-icon-button')} aria-label="Close" onClick={onClose}><X size={17} /></button></header>{children}</DialogPrimitive.Content></DialogPrimitive.Portal></DialogPrimitive.Root>;
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return <div className="spinner-wrap" role="status"><span className="spinner" /> <span>{label}</span></div>;
}

export function Avatar({ name, src }: { name?: string; src?: string }) {
  const [imageState, setImageState] = useState<'loading' | 'loaded' | 'failed'>(src ? 'loading' : 'failed');
  const initials = (name ?? '?').split(/\s+/u).filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase();
  useEffect(() => setImageState(src ? 'loading' : 'failed'), [src]);
  if (!src || imageState === 'failed') return <span className="avatar avatar-fallback" aria-hidden="true">{initials}</span>;
  return <span className="avatar avatar-image-frame"><span className="avatar avatar-fallback" aria-hidden="true">{initials}</span><img className={`avatar avatar-image ${imageState === 'loaded' ? 'loaded' : ''}`} src={src} alt="" onLoad={() => setImageState('loaded')} onError={() => setImageState('failed')} /></span>;
}

export function Field({ label, children, error, required = false, require = false }: { label: ReactNode; children: ReactNode; error?: string | undefined; required?: boolean | undefined; require?: boolean | undefined }) {
  return <label className="field"><Label required={required} require={require}>{label}</Label>{children}{error ? <span className={cn('field-error', 'ui-field-error')} role="alert">{error}</span> : null}</label>;
}

export type ToastTone = 'success' | 'error' | 'info';
export interface ToastMessage { id: string; tone: ToastTone; title: string; detail?: string; }
interface ToastContextValue { show: (message: Omit<ToastMessage, 'id'>) => void; success: (title: string, detail?: string) => void; error: (title: string, detail?: string) => void; info: (title: string, detail?: string) => void; }
const ToastContext = createContext<ToastContextValue | undefined>(undefined);

export function ToastProvider({ children }: PropsWithChildren) {
  const [messages, setMessages] = useState<ToastMessage[]>([]);
  const dismiss = useCallback((id: string) => setMessages(current => current.filter(message => message.id !== id)), []);
  const show = useCallback((message: Omit<ToastMessage, 'id'>) => {
    const next = { ...message, id: crypto.randomUUID() };
    setMessages(current => [...current.slice(-3), next]);
    window.setTimeout(() => dismiss(next.id), 5000);
  }, [dismiss]);
  const value: ToastContextValue = {
    show,
    success: (title, detail) => show({ tone: 'success', title, ...(detail === undefined ? {} : { detail }) }),
    error: (title, detail) => show({ tone: 'error', title, ...(detail === undefined ? {} : { detail }) }),
    info: (title, detail) => show({ tone: 'info', title, ...(detail === undefined ? {} : { detail }) }),
  };
  return <ToastContext.Provider value={value}>{children}<div className="toast-region" aria-live="polite" aria-atomic="true">{messages.map(message => <Toast key={message.id} message={message} onClose={() => dismiss(message.id)} />)}</div></ToastContext.Provider>;
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used inside ToastProvider.');
  return context;
}

export function Toast({ message, onClose }: { message: ToastMessage; onClose: () => void }) {
  const StatusIcon = message.tone === 'success' ? CheckCircle2 : message.tone === 'error' ? XCircle : Info;
  return <article className={`toast toast-${message.tone}`} role={message.tone === 'error' ? 'alert' : 'status'}>
    <Icon icon={StatusIcon} size={16} />
    <div><strong>{message.title}</strong>{message.detail ? <p>{message.detail}</p> : null}</div>
    <button type="button" className={cn('icon-button', 'ui-icon-button')} aria-label="Dismiss notification" onClick={onClose}><Icon icon={X} size={14} /></button>
  </article>;
}
