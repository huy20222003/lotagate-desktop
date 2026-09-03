import { Card, Skeleton } from '../../components/ui.js';

export function SettingsPageSkeleton({ rows = 4 }: { rows?: number }) {
  return <div className="settings-page-skeleton" aria-label="Loading settings">
    <Skeleton className="settings-page-skeleton-heading" />
    <Card className="settings-page-skeleton-card">
      {Array.from({ length: rows }, (_, index) => <div className="settings-page-skeleton-row" key={index}>
        <span><Skeleton className="settings-page-skeleton-label" /><Skeleton className="settings-page-skeleton-description" /></span>
        <Skeleton className="settings-page-skeleton-control" />
      </div>)}
    </Card>
  </div>;
}
