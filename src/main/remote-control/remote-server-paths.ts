export const DEFAULT_REMOTE_SERVER_GLOBAL_PREFIX = 'api/v1';

export function normalizeRemoteServerGlobalPrefix(value: string): string | undefined {
  const normalized = value.trim().replace(/^\/+|\/+$/gu, '');
  if (!normalized || normalized.split('/').some(segment => !/^[A-Za-z0-9._~-]+$/u.test(segment))) return undefined;
  return normalized;
}

export function remoteServerRoute(globalPrefix: string, path: string): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `/${globalPrefix}${normalizedPath}`;
}
