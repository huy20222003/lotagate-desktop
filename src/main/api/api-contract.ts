export const API_PATHS = {
  cryptoSession: '/auth/crypto-session',
  login: '/auth/login',
  refresh: '/auth/refresh-token',
  logout: '/auth/logout',
  me: '/auth/me',
  profile: '/users/profile',
  paymentHistory: (organizationCode: string, page = 1, limit = 10) => `/organizations/${encodeURIComponent(organizationCode)}/payments?page=${page}&limit=${limit}`,
  changePassword: '/users/change-password',
  organizations: '/organizations',
  organizationWallet: (organizationCode: string) => `/organizations/${encodeURIComponent(organizationCode)}/wallet`,
  organizationUsage: (organizationCode: string, workspaceCode?: string) => workspaceCode === undefined
    ? `/organizations/${encodeURIComponent(organizationCode)}/usage`
    : `/organizations/${encodeURIComponent(organizationCode)}/workspaces/${encodeURIComponent(workspaceCode)}/usage`,
  organizationDashboardStats: (organizationCode: string, workspaceCode?: string) => workspaceCode === undefined
    ? `/organizations/${encodeURIComponent(organizationCode)}/dashboard-stats`
    : `/organizations/${encodeURIComponent(organizationCode)}/workspaces/${encodeURIComponent(workspaceCode)}/dashboard-stats`,
} as const;

export const API_CRYPTO = {
  version: 1,
  algorithm: 'A256GCM',
  curve: 'P-256',
  rotateAfterRequests: 100,
  requestInfo: 'lotagate:req',
  responseInfo: 'lotagate:res',
  keyIdHeader: 'x-lg-crypto-kid',
  timestampHeader: 'x-lg-crypto-ts',
  sequenceHeader: 'x-lg-crypto-seq',
  requestIdHeader: 'x-lg-crypto-rid',
  csrfCookieName: 'lg_csrf_token',
  csrfHeaderName: 'x-lg-csrf',
} as const;

export const API_AUTH_COOKIES = {
  access: 'lg_access_token',
  refresh: 'lg_refresh_token',
} as const;

export const DESKTOP_ALLOWED_API_PATHS = new Set<string>([
  API_PATHS.cryptoSession,
  API_PATHS.login,
  API_PATHS.refresh,
  API_PATHS.logout,
  API_PATHS.me,
  API_PATHS.profile,
  API_PATHS.changePassword,
  API_PATHS.organizations,
]);

export function isDesktopApiPathAllowed(path: string): boolean {
  if (DESKTOP_ALLOWED_API_PATHS.has(path)) return true;
  const [pathname = '', query = ''] = path.split('?', 2);
  const segments = pathname.split('/').slice(1);
  if (segments.length === 2 && segments[0] === 'organizations' && safePathSegment(segments[1])) return true;
  if (segments.length === 3 && segments[0] === 'organizations' && safePathSegment(segments[1]) && segments[2] === 'wallet') return true;
  if (segments.length === 3 && segments[0] === 'organizations' && safePathSegment(segments[1]) && segments[2] === 'payments' && isPaginationQueryAllowed(query)) return true;
  if (segments.length === 3 && segments[0] === 'organizations' && safePathSegment(segments[1]) && segments[2] === 'workspaces') return true;
  if (segments.length === 3 && segments[0] === 'organizations' && safePathSegment(segments[1]) && segments[2] === 'usage') return true;
  if (segments.length === 3 && segments[0] === 'organizations' && safePathSegment(segments[1]) && segments[2] === 'dashboard-stats') return true;
  if (segments.length === 5 && segments[0] === 'organizations' && safePathSegment(segments[1]) && segments[2] === 'workspaces' && safePathSegment(segments[3]) && segments[4] === 'usage') return true;
  if (segments.length === 5 && segments[0] === 'organizations' && safePathSegment(segments[1]) && segments[2] === 'workspaces' && safePathSegment(segments[3]) && segments[4] === 'dashboard-stats') return true;
  return segments.length === 5 && segments[0] === 'organizations' && safePathSegment(segments[1]) && segments[2] === 'workspaces' && safePathSegment(segments[3]) && segments[4] === 'models';
}

function safePathSegment(value: string | undefined): boolean { if (!value || value.length > 256 || value.includes('/') || value.includes('\\')) return false; try { const decoded = decodeURIComponent(value); return decoded.length > 0 && !decoded.includes('/'); } catch { return false; } }

function isPaginationQueryAllowed(query: string): boolean {
  if (!query) return false;
  const params = new URLSearchParams(query);
  if (params.size !== 2 || params.getAll('page').length !== 1 || params.getAll('limit').length !== 1) return false;
  const page = Number(params.get('page'));
  const limit = Number(params.get('limit'));
  return Number.isInteger(page) && page >= 1 && Number.isInteger(limit) && limit >= 1 && limit <= 100;
}
