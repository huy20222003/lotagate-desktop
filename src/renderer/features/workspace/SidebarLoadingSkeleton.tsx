import { Skeleton } from '../../components/ui.js';

export function SidebarLoadingSkeleton() {
  return <div className="sidebar-loading-skeleton"><div className="workspace-skeleton-row"><Skeleton className="skeleton-icon" /><Skeleton className="skeleton-sidebar-line workspace-skeleton-line" /></div><Skeleton className="skeleton-sidebar-line session-skeleton-line" /><Skeleton className="skeleton-sidebar-line session-skeleton-line" /><Skeleton className="skeleton-sidebar-line session-skeleton-line" /></div>;
}
