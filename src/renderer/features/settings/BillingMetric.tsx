import { Card, Skeleton } from '../../components/ui.js';

export function Metric({ label, value, loading = false }: { label: string; value: string; loading?: boolean }) {
  return <Card className="billing-metric"><span>{label}</span><strong>{loading ? <Skeleton className="skeleton-value">{value}</Skeleton> : value}</strong></Card>;
}
