import crypto from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';

export interface DesktopRuntimeConfig {
  apiBaseUrl: string;
  trustedOrigin: string;
  remoteServerUrl: string;
  remoteServerGlobalPrefix: string;
  remoteServerEnrollmentToken: string;
  authPartition: string;
}

interface RuntimeConfigArtifact {
  version: 1;
  algorithm: 'aes-256-gcm';
  salt: string;
  iv: string;
  authTag: string;
  ciphertext: string;
}

interface RuntimeConfigPayload {
  version: 1;
  values: Record<string, string>;
}

const RUNTIME_CONFIG_SEED = 'lotagate-desktop-runtime-config-v1';
const RUNTIME_CONFIG_FILE = 'runtime.dat';

export function loadRuntimeEnvironment(): void {
  const candidates = app.isPackaged
    ? typeof process.resourcesPath === 'string' ? [join(process.resourcesPath, RUNTIME_CONFIG_FILE)] : []
    : [join(process.cwd(), '.env')];
  const environmentFile = candidates.find(candidate => existsSync(candidate));
  if (environmentFile === undefined) return;
  if (environmentFile.endsWith(RUNTIME_CONFIG_FILE)) {
    applyRuntimeValues(decryptRuntimeConfig(readFileSync(environmentFile, 'utf8')));
    return;
  }
  for (const key of PACKAGED_RUNTIME_KEYS) {
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

function applyRuntimeValues(values: Record<string, string>): void {
  for (const [key, value] of Object.entries(values)) {
    if (!PACKAGED_RUNTIME_KEYS.has(key)) continue;
    if (process.env[key]?.trim().length === 0) delete process.env[key];
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

const PACKAGED_RUNTIME_KEYS = new Set([
  'LOTAGATE_API_BASE_URL',
  'LOTAGATE_TRUSTED_ORIGIN',
  'LOTAGATE_REMOTE_SERVER_URL',
  'LOTAGATE_REMOTE_SERVER_GLOBAL_PREFIX',
  'LOTAGATE_REMOTE_SERVER_ENROLLMENT_TOKEN',
]);

function decryptRuntimeConfig(raw: string): Record<string, string> {
  const artifact = parseRuntimeConfigArtifact(raw);
  const salt = decodeArtifactPart(artifact.salt, 'salt');
  const iv = decodeArtifactPart(artifact.iv, 'iv');
  const authTag = decodeArtifactPart(artifact.authTag, 'auth tag');
  const ciphertext = decodeArtifactPart(artifact.ciphertext, 'ciphertext');
  try {
    const key = crypto.scryptSync(RUNTIME_CONFIG_SEED, salt, 32);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
    const payload: unknown = JSON.parse(plaintext);
    if (!isRuntimeConfigPayload(payload)) throw new Error('Invalid runtime configuration payload.');
    return payload.values;
  } catch {
    throw new Error('The packaged runtime configuration cannot be decrypted.');
  }
}

function parseRuntimeConfigArtifact(raw: string): RuntimeConfigArtifact {
  try {
    const value: unknown = JSON.parse(raw);
    if (!isRuntimeConfigArtifact(value)) throw new Error('Invalid runtime configuration artifact.');
    return value;
  } catch {
    throw new Error('The packaged runtime configuration is invalid.');
  }
}

function decodeArtifactPart(value: string, label: string): Buffer {
  const decoded = Buffer.from(value, 'base64');
  if (decoded.length === 0) throw new Error(`The runtime configuration ${label} is empty.`);
  return decoded;
}

function isRuntimeConfigArtifact(value: unknown): value is RuntimeConfigArtifact {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return record['version'] === 1
    && record['algorithm'] === 'aes-256-gcm'
    && typeof record['salt'] === 'string'
    && typeof record['iv'] === 'string'
    && typeof record['authTag'] === 'string'
    && typeof record['ciphertext'] === 'string';
}

function isRuntimeConfigPayload(value: unknown): value is RuntimeConfigPayload {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  if (record['version'] !== 1 || typeof record['values'] !== 'object' || record['values'] === null) return false;
  return Object.values(record['values'] as Record<string, unknown>).every(item => typeof item === 'string');
}
