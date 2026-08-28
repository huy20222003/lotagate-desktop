import type { PropsWithChildren, ReactNode } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { cn } from '../../utils/cn.js';

export function OverlayDialog({ label, children, onClose, className = '', overlayClassName = '', overlayChildren }: PropsWithChildren<{ label: string; onClose: () => void; className?: string; overlayClassName?: string; overlayChildren?: ReactNode }>) {
  return <DialogPrimitive.Root open onOpenChange={open => { if (!open) onClose(); }}><DialogPrimitive.Portal><DialogPrimitive.Overlay className={cn('ui-dialog-overlay', overlayClassName)}>{overlayChildren}</DialogPrimitive.Overlay><DialogPrimitive.Content className={cn('ui-dialog-content', className)} onEscapeKeyDown={event => { event.preventDefault(); onClose(); }} onPointerDownOutside={onClose}><DialogPrimitive.Title className="ui-visually-hidden">{label}</DialogPrimitive.Title>{children}</DialogPrimitive.Content></DialogPrimitive.Portal></DialogPrimitive.Root>;
}
