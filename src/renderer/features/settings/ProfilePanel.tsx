import { useEffect, useState } from 'react';
import type { UserProfile } from '../../../contracts/ipc/v1/auth.js';
import { Avatar, Card, Skeleton, Tooltip } from '../../components/ui.js';
import { extractArray, readNumber } from '../../utils/data.js';

export function ProfilePanel({ user, accountName }: { user: UserProfile; accountName: string }) {
  const organization = user.organizations.find(item => item.organizationCode === user.defaultOrganizationCode) ?? user.organizations[0];
  const [summary, setSummary] = useState<ProfileSummary>({ workspaceCount: 0, chatCount: 0, lifetimeTokens: 0, peakTokens: 0, modelsUsed: 0, dailyTokens: new Map() });
  const [loading, setLoading] = useState(true);
  const [profileError, setProfileError] = useState(false);
  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setProfileError(false);
    void (async () => {
      const analyticsPromise = organization?.organizationCode === undefined
        ? Promise.resolve<[unknown, unknown]>([[], null])
        : Promise.all([window.lotagate.userContext.usage(organization.organizationCode), window.lotagate.userContext.dashboardStats(organization.organizationCode)]);
      const workspaces = await window.lotagate.workspaces.list().catch(() => []);
      const tasks = (await Promise.all(workspaces.map(workspace => window.lotagate.tasks.list(workspace.id).catch(() => [])))).flat();
      const [usage, dashboard] = await analyticsPromise;
      const usageModels = normalizeUsage(usage);
      const apiDailyTokens = normalizeDailyTokens(dashboard);
      const localDailyTokens = new Map<string, number>();
      if (apiDailyTokens.size === 0) {
        const activities = (await Promise.all(tasks.map(task => window.lotagate.tasks.activities(task.id).catch(() => [])))).flat();
        for (const activity of activities) {
          if (activity.kind !== 'usage') continue;
          const tokens = readTokens(activity.metadata['usage']);
          if (tokens <= 0) continue;
          const day = activity.createdAt.slice(0, 10);
          localDailyTokens.set(day, (localDailyTokens.get(day) ?? 0) + tokens);
        }
      }
      const dailyTokens = apiDailyTokens.size > 0 ? apiDailyTokens : localDailyTokens;
      const dashboardTokens = readNumber(dashboardValue(dashboard, 'totalTokens')) ?? 0;
      const usageTokens = usageModels.reduce((total, model) => total + model.totalTokens, 0);
      if (!mounted) return;
      setSummary({ workspaceCount: workspaces.length, chatCount: tasks.filter(task => !task.archived).length, lifetimeTokens: dashboardTokens || usageTokens, peakTokens: usageModels.reduce((peak, model) => Math.max(peak, model.totalTokens), dashboardTokens), modelsUsed: usageModels.length, dailyTokens });
    })().catch(() => { if (mounted) setProfileError(true); }).finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, [organization?.organizationCode, user.defaultWorkspaceCode]);
  return <div className="profile-panel"><div className="profile-identity"><Avatar name={accountName} {...(user.avatarUrl ? { src: user.avatarUrl } : {})} /><h2>{accountName}</h2><p className="settings-muted">{user.username ? `@${user.username}` : user.email}</p></div>{profileError ? <Card className="settings-empty"><strong>Profile data is unavailable</strong><p>Your session may have expired. Please sign in again.</p></Card> : <><ProfileMetrics summary={summary} loading={loading} /><ProfileActivity summary={summary} loading={loading} /><Card className="profile-details"><dl><div><dt>Email</dt><dd>{user.email}</dd></div><div><dt>Organization</dt><dd>{organization?.displayName ?? 'Personal workspace'}</dd></div><div><dt>Role</dt><dd>{organization?.role ?? 'Member'}</dd></div></dl></Card></>}</div>;
}

function ProfileMetrics({ summary, loading }: { summary: ProfileSummary; loading: boolean }) {
  return <div className="profile-metrics"><div><strong>{loading ? <Skeleton className="skeleton-value">0</Skeleton> : formatTokens(summary.lifetimeTokens)}</strong><span>Lifetime tokens</span></div><div><strong>{loading ? <Skeleton className="skeleton-value">0</Skeleton> : formatTokens(summary.peakTokens)}</strong><span>Peak model tokens</span></div><div><strong>{loading ? <Skeleton className="skeleton-value">0</Skeleton> : summary.modelsUsed}</strong><span>Models used</span></div><div><strong>{loading ? <Skeleton className="skeleton-value">0</Skeleton> : summary.chatCount}</strong><span>Total chats</span></div><div><strong>{loading ? <Skeleton className="skeleton-value">0</Skeleton> : summary.dailyTokens.size}</strong><span>Active days</span></div></div>;
}

function ProfileActivity({ summary, loading }: { summary: ProfileSummary; loading: boolean }) {
  const today = new Date();
  const start = new Date(today);
  start.setDate(today.getDate() - 364 - today.getDay());
  const days = Array.from({ length: 371 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    const key = date.toISOString().slice(0, 10);
    return { key, count: summary.dailyTokens.get(key) ?? 0 };
  });
  const peak = Math.max(...days.map(day => day.count), 0);
  const monthLabels = Array.from({ length: 12 }, (_, index) => new Date(today.getFullYear(), today.getMonth() - 11 + index, 1).toLocaleString(undefined, { month: 'short' }));
  return <section className="profile-activity"><div className="profile-section-heading"><strong>Token activity</strong><span>Daily</span></div><div className="profile-activity-grid" aria-label="Token activity over the last year">{days.map(day => <Tooltip key={day.key} label={loading ? 'Loading activity' : `${day.key}: ${formatTokens(day.count)} tokens`}>{loading ? <Skeleton className="skeleton-cell" /> : <span className={`activity-cell activity-level-${activityLevel(day.count, peak)}`} />}</Tooltip>)}</div><div className="profile-month-labels" aria-hidden="true">{monthLabels.map((label, index) => <span key={`${label}-${index}`}>{label}</span>)}</div></section>;
}

interface ProfileSummary { workspaceCount: number; chatCount: number; lifetimeTokens: number; peakTokens: number; modelsUsed: number; dailyTokens: Map<string, number> }
interface UsageModel { modelCode: string; totalTokens: number }
function activityLevel(count: number, peak: number): 0 | 1 | 2 | 3 { if (count === 0 || peak === 0) return 0; if (count <= peak * .25) return 1; if (count <= peak * .65) return 2; return 3; }
function normalizeUsage(value: unknown): UsageModel[] { return extractArray(value, ['data', 'items', 'models', 'usage']).flatMap(item => { if (typeof item !== 'object' || item === null) return []; const record = item as Record<string, unknown>; const nestedModel = typeof record['model'] === 'object' && record['model'] !== null ? record['model'] as Record<string, unknown> : undefined; const modelCode = typeof record['modelCode'] === 'string' ? record['modelCode'] : typeof nestedModel?.['modelCode'] === 'string' ? nestedModel['modelCode'] : typeof nestedModel?.['displayName'] === 'string' ? nestedModel['displayName'] : undefined; return modelCode === undefined ? [] : [{ modelCode, totalTokens: readTokens(record) }]; }); }
function readTokens(value: unknown): number { if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, value); if (typeof value === 'string' && Number.isFinite(Number(value))) return Math.max(0, Number(value)); if (typeof value !== 'object' || value === null) return 0; const record = value as Record<string, unknown>; const total = readNumber(record['totalTokens']); if (total !== undefined) return total; return Math.max(0, (readNumber(record['promptTokens']) ?? 0) + (readNumber(record['completionTokens']) ?? 0)); }
function normalizeDailyTokens(value: unknown): Map<string, number> { const record = typeof value === 'object' && value !== null ? value as Record<string, unknown> : undefined; return new Map(extractArray(record?.['sevenDaySpend']).flatMap(item => { if (typeof item !== 'object' || item === null) return []; const row = item as Record<string, unknown>; const date = typeof row['date'] === 'string' ? row['date'].slice(0, 10) : undefined; return date === undefined ? [] : [[date, readNumber(row['tokens']) ?? 0] as [string, number]]; })); }
function dashboardValue(value: unknown, key: string): unknown { return typeof value === 'object' && value !== null ? (value as Record<string, unknown>)[key] : undefined; }
function formatTokens(value: number): string { if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`; if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`; return String(Math.round(value)); }
