import type { ReactNode } from 'react';

export function EmptyState({ title, detail, action }: { title: string; detail?: string; action?: ReactNode }) {
  return <div className="empty-state"><strong>{title}</strong>{detail ? <p>{detail}</p> : null}{action}</div>;
}
