import type { ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { Scrollbar } from '../../components/Scrollbar.js';

export function OrchestrationDrawer({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  return <aside className="orchestration-drawer" aria-label={title}><header><strong>{title}</strong><button type="button" className="icon-button" aria-label="Close orchestration details" onClick={onClose}><ChevronRight size={16} /></button></header><Scrollbar className="orchestration-drawer-scroll">{children}</Scrollbar></aside>;
}
