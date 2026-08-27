import { Skeleton, Tooltip } from '../../components/ui.js';
import { activityLevel, formatTokens } from './profile-format.js';
import type { ProfileSummary } from './profile-types.js';

export function ProfileActivity({ summary, loading }: { summary: ProfileSummary; loading: boolean }) {
  const today = new Date();
  const start = new Date(today);
  start.setDate(today.getDate() - 364 - today.getDay());
  const days = Array.from({ length: 371 }, (_, index) => { const date = new Date(start); date.setDate(start.getDate() + index); const key = date.toISOString().slice(0, 10); return { key, count: summary.dailyTokens.get(key) ?? 0 }; });
  const peak = Math.max(...days.map(day => day.count), 0);
  const monthLabels = Array.from({ length: 12 }, (_, index) => new Date(today.getFullYear(), today.getMonth() - 11 + index, 1).toLocaleString(undefined, { month: 'short' }));
  return <section className="profile-activity"><div className="profile-section-heading"><strong>Token activity</strong><span>Daily</span></div><div className="profile-activity-grid" aria-label="Token activity over the last year">{days.map(day => <Tooltip key={day.key} label={loading ? 'Loading activity' : `${day.key}: ${formatTokens(day.count)} tokens`}>{loading ? <Skeleton className="skeleton-cell" /> : <span className={`activity-cell activity-level-${activityLevel(day.count, peak)}`} />}</Tooltip>)}</div><div className="profile-month-labels" aria-hidden="true">{monthLabels.map((label, index) => <span key={`${label}-${index}`}>{label}</span>)}</div></section>;
}
