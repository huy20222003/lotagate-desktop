import { Card, Skeleton } from '../../components/ui.js';

export function ExtensionListSkeleton() {
  return <div className="settings-extension-list">{[1, 2, 3].map(index => <Card className="settings-extension-row" key={index}><Skeleton className="settings-extension-skeleton" /></Card>)}</div>;
}
