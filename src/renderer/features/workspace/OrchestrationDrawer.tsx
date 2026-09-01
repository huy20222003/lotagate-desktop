import { useEffect, useRef, type ReactNode } from 'react';
import { ChevronRight, type LucideIcon } from 'lucide-react';
import { Scrollbar } from '../../components/Scrollbar.js';
import { IconButton } from '../../components/ui.js';

export function OrchestrationDrawer({ title, children, onClose, closeIcon: CloseIcon = ChevronRight, closeLabel = 'Close orchestration details' }: { title: string; children: ReactNode; onClose: () => void; closeIcon?: LucideIcon; closeLabel?: string }) {
  const drawerRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const closeOnOutsidePointer = (event: PointerEvent): void => {
      if (!drawerRef.current?.contains(event.target as Node)) onClose();
    };
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    document.addEventListener('keydown', closeOnEscape);
    return () => { document.removeEventListener('pointerdown', closeOnOutsidePointer); document.removeEventListener('keydown', closeOnEscape); };
  }, [onClose]);
  return <aside ref={drawerRef} className="orchestration-drawer" aria-label={title}><header><strong>{title}</strong><IconButton icon={CloseIcon} label={closeLabel} onClick={onClose} /></header><Scrollbar className="orchestration-drawer-scroll">{children}</Scrollbar></aside>;
}
