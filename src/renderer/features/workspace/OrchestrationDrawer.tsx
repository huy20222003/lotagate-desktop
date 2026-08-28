import type { ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { Scrollbar } from '../../components/Scrollbar.js';
import { IconButton } from '../../components/ui.js';

export function OrchestrationDrawer({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  return <aside className="orchestration-drawer" aria-label={title}><header><strong>{title}</strong><IconButton icon={ChevronRight} label="Close orchestration details" onClick={onClose} /></header><Scrollbar className="orchestration-drawer-scroll">{children}</Scrollbar></aside>;
}
