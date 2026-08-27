import { Skeleton } from '../../components/ui.js';
import { formatTokens } from './profile-format.js';
import type { ProfileSummary } from './profile-types.js';

export function ProfileMetrics({ summary, loading }: { summary: ProfileSummary; loading: boolean }) {
  return <div className="profile-metrics"><div><strong>{loading ? <Skeleton className="skeleton-value">0</Skeleton> : formatTokens(summary.lifetimeTokens)}</strong><span>Lifetime tokens</span></div><div><strong>{loading ? <Skeleton className="skeleton-value">0</Skeleton> : formatTokens(summary.peakTokens)}</strong><span>Peak model tokens</span></div><div><strong>{loading ? <Skeleton className="skeleton-value">0</Skeleton> : summary.modelsUsed}</strong><span>Models used</span></div><div><strong>{loading ? <Skeleton className="skeleton-value">0</Skeleton> : summary.chatCount}</strong><span>Total chats</span></div><div><strong>{loading ? <Skeleton className="skeleton-value">0</Skeleton> : summary.dailyTokens.size}</strong><span>Active days</span></div></div>;
}
