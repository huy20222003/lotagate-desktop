import { existsSync } from 'node:fs';
import { join } from 'node:path';

export interface DesktopRuntimeConfig {
  apiBaseUrl: string;
  trustedOrigin: string;
  remoteServerUrl: string;
  remoteServerGlobalPrefix: string;
  remoteServerEnrollmentToken: string;
  authPartition: string;
}

export function loadRuntimeEnvironment(): void {
  const candidates = [join(process.cwd(), '.env')];
  if (typeof process.resourcesPath === 'string') candidates.unshift(join(process.resourcesPath, '.env'));
  const environmentFile = candidates.find(candidate => existsSync(candidate));
  if (environmentFile === undefined) return;
  for (const key of ['LOTAGATE_API_BASE_URL', 'LOTAGATE_TRUSTED_ORIGIN', 'LOTAGATE_REMOTE_SERVER_URL', 'LOTAGATE_REMOTE_SERVER_GLOBAL_PREFIX', 'LOTAGATE_REMOTE_SERVER_ENROLLMENT_TOKEN']) {
    if (process.env[key]?.trim().length === 0) delete process.env[key];
  }
  process.loadEnvFile(environmentFile);
}

export function readRuntimeConfig(): DesktopRuntimeConfig {
  return {
    apiBaseUrl: process.env['LOTAGATE_API_BASE_URL']?.trim() ?? '',
    trustedOrigin: process.env['LOTAGATE_TRUSTED_ORIGIN']?.trim() ?? '',
    remoteServerUrl: process.env['LOTAGATE_REMOTE_SERVER_URL']?.trim() ?? '',
    remoteServerGlobalPrefix: process.env['LOTAGATE_REMOTE_SERVER_GLOBAL_PREFIX']?.trim() || 'api/v1',
    remoteServerEnrollmentToken: process.env['LOTAGATE_REMOTE_SERVER_ENROLLMENT_TOKEN']?.trim() ?? '',
    authPartition: 'persist:lotagate-auth',
  };
}
