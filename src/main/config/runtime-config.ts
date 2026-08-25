import { existsSync } from 'node:fs';
import { join } from 'node:path';

export interface DesktopRuntimeConfig {
  apiBaseUrl: string;
  trustedOrigin: string;
  authPartition: string;
}

export function loadRuntimeEnvironment(): void {
  const candidates = [join(process.cwd(), '.env')];
  if (typeof process.resourcesPath === 'string') candidates.unshift(join(process.resourcesPath, '.env'));
  const environmentFile = candidates.find(candidate => existsSync(candidate));
  if (environmentFile === undefined) return;
  for (const key of ['LOTAGATE_API_BASE_URL', 'LOTAGATE_TRUSTED_ORIGIN']) {
    if (process.env[key]?.trim().length === 0) delete process.env[key];
  }
  process.loadEnvFile(environmentFile);
}

export function readRuntimeConfig(): DesktopRuntimeConfig {
  return {
    apiBaseUrl: process.env['LOTAGATE_API_BASE_URL']?.trim() ?? '',
    trustedOrigin: process.env['LOTAGATE_TRUSTED_ORIGIN']?.trim() ?? '',
    authPartition: 'persist:lotagate-auth',
  };
}
