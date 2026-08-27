import type { PropsWithChildren } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from '../../utils/cn.js';

export function Modal({ title, subtitle, children, onClose, className = '' }: PropsWithChildren<{ title: string; subtitle?: string; onClose: () => void; className?: string }>) {
  return <DialogPrimitive.Root open onOpenChange={open => { if (!open) onClose(); }}><DialogPrimitive.Portal><DialogPrimitive.Overlay className={cn('modal-backdrop', 'ui-dialog-overlay')} /><DialogPrimitive.Content className={cn('modal', 'ui-dialog-content', className)} onPointerDownOutside={event => event.preventDefault()}><header className="modal-header"><div className="modal-heading"><DialogPrimitive.Title asChild><h2>{title}</h2></DialogPrimitive.Title>{subtitle ? <DialogPrimitive.Description asChild><span className="modal-subtitle">{subtitle}</span></DialogPrimitive.Description> : null}</div><button type="button" className={cn('icon-button', 'ui-icon-button')} aria-label="Close" onClick={onClose}><X size={17} /></button></header>{children}</DialogPrimitive.Content></DialogPrimitive.Portal></DialogPrimitive.Root>;
}
