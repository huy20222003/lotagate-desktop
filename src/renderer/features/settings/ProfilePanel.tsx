import { useEffect, useState } from 'react';
import type { UserProfile } from '../../../contracts/ipc/v1/auth.js';
import { Avatar, Card } from '../../components/ui.js';
import { extractArray, readNumber } from '../../utils/data.js';
import { ProfileActivity } from './ProfileActivity.js';
import { ProfileModelUsage } from './ProfileModelUsage.js';
import { ProfileMetrics } from './ProfileMetrics.js';
import type { ModelUsageSummary, ProfileSummary } from './profile-types.js';

export function ProfilePanel({ user, accountName }: { user: UserProfile; accountName: string }) {
  const organization = user.organizations.find(item => item.organizationCode === user.defaultOrganizationCode) ?? user.organizations[0];
  const [summary, setSummary] = useState<ProfileSummary>({ workspaceCount: 0, chatCount: 0, lifetimeTokens: 0, peakTokens: 0, modelsUsed: 0, dailyTokens: new Map(), modelUsage: [] });
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
        const values = await window.lotagate.tasks.dailyUsage().catch(() => ({}));
        for (const [day, tokens] of Object.entries(values)) if (Number.isFinite(tokens) && tokens > 0) localDailyTokens.set(day, tokens);
      }
      const dailyTokens = apiDailyTokens.size > 0 ? apiDailyTokens : localDailyTokens;
      const dashboardTokens = readNumber(dashboardValue(dashboard, 'totalTokens')) ?? 0;
      const usageTokens = usageModels.reduce((total, model) => total + model.totalTokens, 0);
      if (!mounted) return;
      setSummary({ workspaceCount: workspaces.length, chatCount: tasks.filter(task => !task.archived).length, lifetimeTokens: dashboardTokens || usageTokens, peakTokens: usageModels.reduce((peak, model) => Math.max(peak, model.totalTokens), dashboardTokens), modelsUsed: usageModels.length, dailyTokens, modelUsage: usageModels });
    })().catch(() => { if (mounted) setProfileError(true); }).finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, [organization?.organizationCode, user.defaultWorkspaceCode]);
  return <div className="profile-panel"><div className="profile-identity"><Avatar name={accountName} {...(user.avatarUrl ? { src: user.avatarUrl } : {})} /><h2>{accountName}</h2><p className="settings-muted">{user.username ? `@${user.username}` : user.email}</p></div>{profileError ? <Card className="settings-empty"><strong>Profile data is unavailable</strong><p>Your session may have expired. Please sign in again.</p></Card> : <><ProfileMetrics summary={summary} loading={loading} /><ProfileActivity summary={summary} loading={loading} /><Card className="profile-details"><dl><div><dt>Email</dt><dd>{user.email}</dd></div><div><dt>Organization</dt><dd>{organization?.displayName ?? 'Personal workspace'}</dd></div><div><dt>Role</dt><dd>{organization?.role ?? 'Member'}</dd></div></dl></Card><ProfileModelUsage models={summary.modelUsage} loading={loading} /></>}</div>;
}

function normalizeUsage(value: unknown): ModelUsageSummary[] {
  const models = new Map<string, ModelUsageSummary>();
  for (const item of extractArray(value, ['data', 'items', 'models', 'usage'])) {
    if (typeof item !== 'object' || item === null) continue;
    const record = item as Record<string, unknown>;
    const nestedModel = typeof record['model'] === 'object' && record['model'] !== null ? record['model'] as Record<string, unknown> : undefined;
    const modelCode = typeof record['modelCode'] === 'string' ? record['modelCode'] : typeof nestedModel?.['modelCode'] === 'string' ? nestedModel['modelCode'] : typeof nestedModel?.['displayName'] === 'string' ? nestedModel['displayName'] : undefined;
    if (modelCode === undefined) continue;
    const current = models.get(modelCode) ?? { modelCode, totalTokens: 0, totalRequests: 0 };
    current.totalTokens += readTokens(record);
    current.totalRequests += readNumber(record['totalRequests']) ?? 0;
    models.set(modelCode, current);
  }
  return [...models.values()].sort((left, right) => right.totalTokens - left.totalTokens || left.modelCode.localeCompare(right.modelCode));
}
function readTokens(value: unknown): number { if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, value); if (typeof value === 'string' && Number.isFinite(Number(value))) return Math.max(0, Number(value)); if (typeof value !== 'object' || value === null) return 0; const record = value as Record<string, unknown>; const total = readNumber(record['totalTokens']); if (total !== undefined) return total; return Math.max(0, (readNumber(record['promptTokens']) ?? 0) + (readNumber(record['completionTokens']) ?? 0)); }
function normalizeDailyTokens(value: unknown): Map<string, number> { const record = typeof value === 'object' && value !== null ? value as Record<string, unknown> : undefined; return new Map(extractArray(record?.['sevenDaySpend']).flatMap(item => { if (typeof item !== 'object' || item === null) return []; const row = item as Record<string, unknown>; const date = typeof row['date'] === 'string' ? row['date'].slice(0, 10) : undefined; return date === undefined ? [] : [[date, readNumber(row['tokens']) ?? 0] as [string, number]]; })); }
function dashboardValue(value: unknown, key: string): unknown { return typeof value === 'object' && value !== null ? (value as Record<string, unknown>)[key] : undefined; }
