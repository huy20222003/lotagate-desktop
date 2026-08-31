import { Card, Table, type TableColumn } from '../../components/ui.js';
import { formatTokens } from './profile-format.js';
import type { ModelUsageSummary } from './profile-types.js';

interface ModelUsageRow extends ModelUsageSummary { id: string; rank: number }

export function ProfileModelUsage({ models, loading }: { models: ModelUsageSummary[]; loading: boolean }) {
  const rows: ModelUsageRow[] = models.slice(0, 10).map((model, index) => ({ ...model, id: model.modelCode, rank: index + 1 }));
  const columns: TableColumn<ModelUsageRow>[] = [
    { key: 'rank', label: '#' },
    { key: 'modelCode', label: 'Model' },
    { key: 'totalTokens', label: 'Tokens used', render: row => formatTokens(row.totalTokens) },
    { key: 'totalRequests', label: 'Requests', render: row => row.totalRequests.toLocaleString() },
  ];
  return <section className="profile-model-usage"><div className="profile-section-heading"><strong>Top models by token usage</strong><span>Top 10</span></div>{loading ? <Card className="profile-model-usage-status">Loading model usage…</Card> : rows.length === 0 ? <Card className="profile-model-usage-status">No model usage recorded yet.</Card> : <Table columns={columns} rows={rows} />}</section>;
}
