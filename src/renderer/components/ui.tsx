import type { ButtonHTMLAttributes, InputHTMLAttributes, PropsWithChildren, ReactNode, TextareaHTMLAttributes } from 'react';
import { createContext, forwardRef, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Check, CheckCircle2, ChevronDown, Copy, Info, X, XCircle } from 'lucide-react';
import { Scrollbar } from './Scrollbar.js';
import { useClipboard } from '../hooks/use-clipboard.js';

export function Button({ variant = 'secondary', className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger' }) {
  return <button className={`button button-${variant} ${className}`} {...props} />;
}

export function Icon({ icon: IconComponent, size = 16, label, ...props }: { icon: LucideIcon; size?: number; label?: string; className?: string }) {
  return <IconComponent size={size} aria-hidden={label === undefined} aria-label={label} {...props} />;
}

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input className="text-input" {...props} />;
}

export const TextArea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className = '', ...props }, ref) => <textarea ref={ref} className={`text-input text-area ${className}`} {...props} />);
export function Label({ children }: PropsWithChildren) { return <span className="field-label">{children}</span>; }
export function Checkbox({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) { return <label className="check-control"><input type="checkbox" checked={checked} onChange={event => onChange(event.target.checked)} /> <span>{label}</span></label>; }
export function Radio({ label, checked, onChange }: { label: string; checked: boolean; onChange: () => void }) { return <label className="check-control"><input type="radio" checked={checked} onChange={onChange} /> <span>{label}</span></label>; }
export function Badge({ children, tone = 'neutral', size = 'sm', className = '' }: PropsWithChildren<{ tone?: 'neutral' | 'success' | 'warning' | 'danger'; size?: 'sm' | 'md'; className?: string }>) { return <span className={`badge badge-${tone} badge-${size} ${className}`}>{children}</span>; }
export function Card({ children, className = '' }: PropsWithChildren<{ className?: string }>) { return <section className={`card ${className}`}>{children}</section>; }
export function Divider() { return <hr className="divider" />; }
export function EmptyState({ title, detail, action }: { title: string; detail?: string; action?: ReactNode }) { return <div className="empty-state"><strong>{title}</strong>{detail ? <p>{detail}</p> : null}{action}</div>; }
export function Tooltip({ label, children }: PropsWithChildren<{ label: string }>) {
  const tooltipRef = useRef<HTMLSpanElement>(null);
  const [placement, setPlacement] = useState<'top' | 'bottom'>('top');
  useLayoutEffect(() => {
    const updatePlacement = () => {
      const tooltip = tooltipRef.current;
      const bubble = tooltip?.querySelector<HTMLElement>('.tooltip-bubble');
      if (!tooltip || !bubble) return;
      const bounds = tooltip.getBoundingClientRect();
      const bubbleHeight = bubble.getBoundingClientRect().height;
      const gap = 7;
      const below = window.innerHeight - bounds.bottom;
      const above = bounds.top;
      setPlacement(below >= bubbleHeight + gap || below >= above ? 'bottom' : 'top');
    };
    updatePlacement();
    window.addEventListener('resize', updatePlacement);
    window.addEventListener('scroll', updatePlacement, true);
    return () => {
      window.removeEventListener('resize', updatePlacement);
      window.removeEventListener('scroll', updatePlacement, true);
    };
  }, []);
  return <span ref={tooltipRef} className={`tooltip-wrap tooltip-${placement}`}><span className="tooltip-bubble" role="tooltip">{label}</span>{children}</span>;
}
export function Skeleton({ children, className = '' }: PropsWithChildren<{ className?: string }>) { return <span className={`skeleton ${className}`} aria-hidden="true">{children}</span>; }

export function CopyTextButton({ content, label }: { content: string; label: string }) {
  const { copy, status } = useClipboard();
  const copied = status === 'copied';
  const tooltipLabel = status === 'error' ? 'Copy failed' : copied ? 'Copied' : label;
  return <Tooltip label={tooltipLabel}><button type="button" className="agent-copy-button" aria-label={label} onClick={() => void copy(content)}>{copied ? <Check size={13} /> : <Copy size={13} />}</button></Tooltip>;
}

export function Dropdown({ label, value, options, onChange, disabled = false, className = '' }: { label?: string; value: string; options: Array<{ value: string; label: string }>; onChange: (value: string) => void; disabled?: boolean; className?: string }) {
  const [open, setOpen] = useState(false);
  const [placement, setPlacement] = useState<'bottom' | 'top'>('bottom');
  const dropdownRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const selected = options.find(option => option.value === value)?.label ?? value;
  useEffect(() => {
    if (!open) return;
    const closeOnOutsideClick = (event: PointerEvent) => { if (!dropdownRef.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', closeOnOutsideClick);
    return () => document.removeEventListener('pointerdown', closeOnOutsideClick);
  }, [open]);
  useLayoutEffect(() => {
    if (!open) return;
    const updatePlacement = () => {
      const trigger = triggerRef.current;
      if (!trigger) return;
      const bounds = trigger.getBoundingClientRect();
      const gap = 8;
      const estimatedHeight = Math.min(320, Math.max(96, options.length * 32 + 8));
      const below = window.innerHeight - bounds.bottom - gap;
      const above = bounds.top - gap;
      setPlacement(below < estimatedHeight && above > below ? 'top' : 'bottom');
    };
    updatePlacement();
    window.addEventListener('resize', updatePlacement);
    window.addEventListener('scroll', updatePlacement, true);
    return () => {
      window.removeEventListener('resize', updatePlacement);
      window.removeEventListener('scroll', updatePlacement, true);
    };
  }, [open, options.length]);
  return <div ref={dropdownRef} className={`dropdown ${className} ${open ? 'open' : ''}`}>{label ? <span className="field-label">{label}</span> : null}<button ref={triggerRef} type="button" className="model-select" aria-label={label ?? 'Select option'} aria-expanded={open} disabled={disabled} onClick={() => setOpen(current => !current)}><span>{selected}</span><ChevronDown size={14} /></button>{open ? <div className={`dropdown-menu dropdown-menu-${placement}`}><Scrollbar><div className="dropdown-options">{options.map(option => <button type="button" key={option.value} className={option.value === value ? 'dropdown-option selected' : 'dropdown-option'} onClick={() => { onChange(option.value); setOpen(false); }}>{option.label}</button>)}</div></Scrollbar></div> : null}</div>;
}

export function Tabs({ value, items, onChange }: { value: string; items: Array<{ value: string; label: string }>; onChange: (value: string) => void }) { return <div className="tabs" role="tablist" aria-label="Views">{items.map(item => <button key={item.value} role="tab" aria-selected={value === item.value} className={`tab ${value === item.value ? 'selected' : ''}`} onClick={() => onChange(item.value)}>{item.label}</button>)}</div>; }

export function Table<T extends { id: string }>({ columns, rows }: { columns: Array<{ key: string; label: string; render?: (row: T) => ReactNode }>; rows: T[] }) { return <div className="table-wrap"><table><thead><tr>{columns.map(column => <th key={column.key} scope="col">{column.label}</th>)}</tr></thead><tbody>{rows.map(row => <tr key={row.id}>{columns.map(column => <td key={column.key}>{column.render ? column.render(row) : String((row as Record<string, unknown>)[column.key] ?? '')}</td>)}</tr>)}</tbody></table></div>; }

export function Modal({ title, subtitle, children, onClose, className = '' }: PropsWithChildren<{ title: string; subtitle?: string; onClose: () => void; className?: string }>) {
  const dialogRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    const focusable = dialog?.querySelector<HTMLElement>('button, input, textarea, select, [tabindex="0"]');
    focusable?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { onClose(); return; }
      if (event.key !== 'Tab' || !dialog) return;
      const elements = [...dialog.querySelectorAll<HTMLElement>('button, input, textarea, select, [tabindex="0"]')].filter(element => !element.hasAttribute('disabled'));
      if (elements.length === 0) return;
      const first = elements[0]; const last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', keydown);
    return () => document.removeEventListener('keydown', keydown);
  }, [onClose]);
  return <div className="modal-backdrop" role="presentation"><section ref={dialogRef} className={`modal ${className}`} role="dialog" aria-modal="true" aria-labelledby="modal-title"><header className="modal-header"><div className="modal-heading"><h2 id="modal-title">{title}</h2>{subtitle ? <span className="modal-subtitle">{subtitle}</span> : null}</div><button className="icon-button" aria-label="Close" onClick={onClose}><X size={17} /></button></header>{children}</section></div>;
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return <div className="spinner-wrap" role="status"><span className="spinner" /> <span>{label}</span></div>;
}

export function Avatar({ name, src }: { name?: string; src?: string }) {
  const [imageState, setImageState] = useState<'loading' | 'loaded' | 'failed'>(src ? 'loading' : 'failed');
  const initials = (name ?? '?').split(/\s+/u).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
  useEffect(() => setImageState(src ? 'loading' : 'failed'), [src]);
  if (!src || imageState === 'failed') return <span className="avatar avatar-fallback" aria-hidden="true">{initials}</span>;
  return <span className="avatar avatar-image-frame"><span className="avatar avatar-fallback" aria-hidden="true">{initials}</span><img className={`avatar avatar-image ${imageState === 'loaded' ? 'loaded' : ''}`} src={src} alt="" onLoad={() => setImageState('loaded')} onError={() => setImageState('failed')} /></span>;
}

export function Field({ label, children, error }: { label: string; children: ReactNode; error?: string }) {
  return <label className="field"><span className="field-label">{label}</span>{children}{error ? <span className="field-error">{error}</span> : null}</label>;
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
    <button className="icon-button" aria-label="Dismiss notification" onClick={onClose}><Icon icon={X} size={14} /></button>
  </article>;
}
