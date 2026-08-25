import type { ButtonHTMLAttributes, InputHTMLAttributes, PropsWithChildren, ReactNode, TextareaHTMLAttributes } from 'react';
import { X } from 'lucide-react';
import { useEffect, useRef } from 'react';

export function Button({ variant = 'secondary', className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger' }) {
  return <button className={`button button-${variant} ${className}`} {...props} />;
}

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input className="text-input" {...props} />;
}

export function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) { return <textarea className="text-input text-area" {...props} />; }
export function Label({ children }: PropsWithChildren) { return <span className="field-label">{children}</span>; }
export function Checkbox({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) { return <label className="check-control"><input type="checkbox" checked={checked} onChange={event => onChange(event.target.checked)} /> <span>{label}</span></label>; }
export function Radio({ label, checked, onChange }: { label: string; checked: boolean; onChange: () => void }) { return <label className="check-control"><input type="radio" checked={checked} onChange={onChange} /> <span>{label}</span></label>; }
export function Badge({ children, tone = 'neutral' }: PropsWithChildren<{ tone?: 'neutral' | 'success' | 'warning' | 'danger' }>) { return <span className={`badge badge-${tone}`}>{children}</span>; }
export function Card({ children, className = '' }: PropsWithChildren<{ className?: string }>) { return <section className={`card ${className}`}>{children}</section>; }
export function Divider() { return <hr className="divider" />; }
export function EmptyState({ title, detail, action }: { title: string; detail?: string; action?: ReactNode }) { return <div className="empty-state"><strong>{title}</strong>{detail ? <p>{detail}</p> : null}{action}</div>; }
export function Tooltip({ label, children }: PropsWithChildren<{ label: string }>) { return <span className="tooltip-wrap" title={label}>{children}</span>; }

export function Dropdown({ label, value, options, onChange }: { label: string; value: string; options: Array<{ value: string; label: string }>; onChange: (value: string) => void }) { return <label className="dropdown"><span className="field-label">{label}</span><select className="model-select" aria-label={label} value={value} onChange={event => onChange(event.target.value)}>{options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>; }

export function Tabs({ value, items, onChange }: { value: string; items: Array<{ value: string; label: string }>; onChange: (value: string) => void }) { return <div className="tabs" role="tablist" aria-label="Views">{items.map(item => <button key={item.value} role="tab" aria-selected={value === item.value} className={`tab ${value === item.value ? 'selected' : ''}`} onClick={() => onChange(item.value)}>{item.label}</button>)}</div>; }

export function Table<T extends { id: string }>({ columns, rows }: { columns: Array<{ key: string; label: string; render?: (row: T) => ReactNode }>; rows: T[] }) { return <div className="table-wrap"><table><thead><tr>{columns.map(column => <th key={column.key} scope="col">{column.label}</th>)}</tr></thead><tbody>{rows.map(row => <tr key={row.id}>{columns.map(column => <td key={column.key}>{column.render ? column.render(row) : String((row as Record<string, unknown>)[column.key] ?? '')}</td>)}</tr>)}</tbody></table></div>; }

export function Modal({ title, children, onClose }: PropsWithChildren<{ title: string; onClose: () => void }>) {
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
  return <div className="modal-backdrop" role="presentation"><section ref={dialogRef} className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><header className="modal-header"><h2 id="modal-title">{title}</h2><button className="icon-button" aria-label="Close" onClick={onClose}><X size={17} /></button></header>{children}</section></div>;
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return <div className="spinner-wrap" role="status"><span className="spinner" /> <span>{label}</span></div>;
}

export function Avatar({ name, src }: { name?: string; src?: string }) {
  const initials = (name ?? '?').split(/\s+/u).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
  return src ? <img className="avatar" src={src} alt="" /> : <span className="avatar avatar-fallback" aria-hidden="true">{initials}</span>;
}

export function Field({ label, children, error }: { label: string; children: ReactNode; error?: string }) {
  return <label className="field"><span className="field-label">{label}</span>{children}{error ? <span className="field-error">{error}</span> : null}</label>;
}
