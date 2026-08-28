import { useEffect, type PropsWithChildren } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from '../../utils/cn.js';
import { IconButton } from './IconButton.js';

export function Modal({ title, subtitle, children, onClose, className = '' }: PropsWithChildren<{ title: string; subtitle?: string; onClose: () => void; className?: string }>) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      const target = event.target;
      if (target instanceof Element && target.closest('[data-radix-menu-content], [data-radix-popper-content-wrapper]')) return;
      event.preventDefault();
      onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);
  return <DialogPrimitive.Root open onOpenChange={open => { if (!open) onClose(); }}><DialogPrimitive.Portal><DialogPrimitive.Overlay className={cn('modal-backdrop', 'ui-dialog-overlay')} onPointerDown={onClose} /><DialogPrimitive.Content className={cn('modal', 'ui-dialog-content', className)} onPointerDownOutside={event => {
    const target = event.target;
    if (target instanceof Element && target.closest('[data-radix-menu-content], [data-radix-popper-content-wrapper]')) event.preventDefault();
  }}><header className="modal-header"><div className="modal-heading"><DialogPrimitive.Title asChild><h2>{title}</h2></DialogPrimitive.Title>{subtitle ? <DialogPrimitive.Description asChild><span className="modal-subtitle">{subtitle}</span></DialogPrimitive.Description> : null}</div><IconButton icon={X} label="Close" iconSize={17} onClick={onClose} /></header>{children}</DialogPrimitive.Content></DialogPrimitive.Portal></DialogPrimitive.Root>;
}
