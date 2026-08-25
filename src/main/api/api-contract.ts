export const API_PATHS = {
  cryptoSession: '/auth/crypto-session',
  login: '/auth/login',
  refresh: '/auth/refresh-token',
  logout: '/auth/logout',
  me: '/auth/me',
  profile: '/users/profile',
  changePassword: '/users/change-password',
  organizations: '/organizations',
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
  const segments = path.split('/').slice(1);
  if (segments.length === 2 && segments[0] === 'organizations' && safePathSegment(segments[1])) return true;
  if (segments.length === 3 && segments[0] === 'organizations' && safePathSegment(segments[1]) && segments[2] === 'workspaces') return true;
  return segments.length === 5 && segments[0] === 'organizations' && safePathSegment(segments[1]) && segments[2] === 'workspaces' && safePathSegment(segments[3]) && segments[4] === 'models';
}

function safePathSegment(value: string | undefined): boolean { if (!value || value.length > 256 || value.includes('/') || value.includes('\\')) return false; try { const decoded = decodeURIComponent(value); return decoded.length > 0 && !decoded.includes('/'); } catch { return false; } }
