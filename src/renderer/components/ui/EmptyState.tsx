import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Icon } from './Icon.js';

export function EmptyState({ title, detail, description, icon, action }: { title: string; detail?: string; description?: string; icon?: LucideIcon; action?: ReactNode }) {
  return <div className="empty-state">{icon ? <Icon icon={icon} size={20} /> : null}<strong>{title}</strong>{(detail ?? description) ? <p>{detail ?? description}</p> : null}{action}</div>;
}
