import { Card, Skeleton } from '../../components/ui.js';

export function PaymentHistorySkeleton() {
  return <div className="billing-history-skeleton">{[1, 2, 3, 4].map(index => <Card key={index}><Skeleton className="billing-history-skeleton-line" /></Card>)}</div>;
}
