import { z } from 'zod';
import { JsonFileStore } from '../persistence/json-file-store.js';
import { desktopDataPath } from '../persistence/app-data-paths.js';
import { normalizeOriginAllowlist } from '../../contracts/ipc/v1/origin-allowlist.js';
import { defaultComputerApplicationAllowlist, normalizeComputerApplicationAllowlist, type ComputerApplicationPlatform } from '../../contracts/ipc/v1/computer-application-allowlist.js';
import { DEFAULT_FILE_OPEN_DESTINATION, fileOpenDestinationSchema, SANDBOX_DEFAULTS, SANDBOX_LIMITS } from '../../contracts/ipc/v1/settings.js';

const browserSettingsSchema = z.object({
  viewportProfile: z.enum(['desktop', 'laptop', 'tablet', 'mobile', 'custom']).default('desktop'),
  customViewport: z.object({ width: z.number().int().min(320).max(3_840).default(1_280), height: z.number().int().min(240).max(2_160).default(800), mobile: z.boolean().default(false), deviceScaleFactor: z.number().min(0.5).max(4).default(1) }).default({}),
  downloadDirectory: z.string().max(4_096).default(''),
  sessionRetention: z.enum(['session', 'persistent', 'ttl']).default('persistent'),
  sessionRetentionMinutes: z.number().int().min(1).max(7 * 24 * 60).default(60),
  originAllowlist: z.array(z.string().max(2_048)).default([]).transform(normalizeOriginAllowlist).pipe(z.array(z.string().min(1).max(2_048)).max(256)),
  clearDataOnClose: z.boolean().default(false),
  evidenceRetentionDays: z.number().int().min(1).max(365).default(30),
});

const sandboxProfileSchema = z.preprocess(value => value === 'documents' ? 'general' : value, z.literal('general'));

const sandboxSettingsSchema = z.preprocess(value => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;
  return {
    ...record,
    runtime: record['runtime'] === 'wsl2' && process.platform !== 'win32' ? 'auto' : record['runtime'],
    // `allowlist` was exposed before the guest proxy existed. Normalize old
    // settings to the only enforceable policies and let the object schema
    // strip the obsolete allowedDomains field.
    networkPolicy: record['networkPolicy'] === 'allowlist' ? 'none' : record['networkPolicy'],
  };
}, z.object({
  runtime: z.enum(['auto', 'wsl2', 'disabled']).default(SANDBOX_DEFAULTS.runtime),
  distribution: z.string().trim().min(1).max(256).default(SANDBOX_DEFAULTS.distribution),
  profile: sandboxProfileSchema.default(SANDBOX_DEFAULTS.profile),
  networkPolicy: z.enum(['none', 'full']).default(SANDBOX_DEFAULTS.networkPolicy),
  workspaceAccess: z.enum(['read-only', 'read-write']).default(SANDBOX_DEFAULTS.workspaceAccess),
  memoryMb: z.number().int().min(SANDBOX_LIMITS.memoryMb.min).max(SANDBOX_LIMITS.memoryMb.max).default(SANDBOX_DEFAULTS.memoryMb),
  cpuCores: z.number().min(SANDBOX_LIMITS.cpuCores.min).max(SANDBOX_LIMITS.cpuCores.max).default(SANDBOX_DEFAULTS.cpuCores),
  pidsLimit: z.number().int().min(SANDBOX_LIMITS.pidsLimit.min).max(SANDBOX_LIMITS.pidsLimit.max).default(SANDBOX_DEFAULTS.pidsLimit),
  diskMb: z.number().int().min(SANDBOX_LIMITS.diskMb.min).max(SANDBOX_LIMITS.diskMb.max).default(SANDBOX_DEFAULTS.diskMb),
  maxConcurrentEnvironments: z.number().int().min(SANDBOX_LIMITS.maxConcurrentEnvironments.min).max(SANDBOX_LIMITS.maxConcurrentEnvironments.max).default(SANDBOX_DEFAULTS.maxConcurrentEnvironments),
  maxConcurrentOperations: z.number().int().min(SANDBOX_LIMITS.maxConcurrentOperations.min).max(SANDBOX_LIMITS.maxConcurrentOperations.max).default(SANDBOX_DEFAULTS.maxConcurrentOperations),
  idleTimeoutMinutes: z.number().int().min(SANDBOX_LIMITS.idleTimeoutMinutes.min).max(SANDBOX_LIMITS.idleTimeoutMinutes.max).default(SANDBOX_DEFAULTS.idleTimeoutMinutes),
  hostFallback: z.enum(['ask', 'allow', 'deny']).default(SANDBOX_DEFAULTS.hostFallback),
  diagnosticsRetentionDays: z.number().int().min(SANDBOX_LIMITS.diagnosticsRetentionDays.min).max(SANDBOX_LIMITS.diagnosticsRetentionDays.max).default(SANDBOX_DEFAULTS.diagnosticsRetentionDays),
}));

const computerApplicationPlatform: ComputerApplicationPlatform = process.platform === 'darwin' ? 'darwin' : process.platform === 'linux' ? 'linux' : 'win32';
const defaultComputerApplications = defaultComputerApplicationAllowlist(computerApplicationPlatform);

const computerSettingsSchema = z.object({
  applicationAllowlist: z.array(z.string().trim().min(1).max(4_096)).default([...defaultComputerApplications]).transform(normalizeComputerApplicationAllowlist).pipe(z.array(z.string().min(1).max(4_096)).max(256)),
});

export const settingsSchema = z.object({
  appearance: z.enum(['system', 'light', 'dark']).default('system'),
  language: z.enum(['en', 'vi']).default('en'),
  reducedMotion: z.boolean().default(false),
  contrast: z.number().int().min(0).max(100).default(60),
  uiFont: z.enum(['inter', 'system', 'mono']).default('inter'),
  codeFont: z.enum(['inter', 'system', 'mono']).default('system'),
  accentColor: z.string().regex(/^#[0-9a-f]{6}$/iu).optional(),
  backgroundColor: z.string().regex(/^#[0-9a-f]{6}$/iu).optional(),
  foregroundColor: z.string().regex(/^#[0-9a-f]{6}$/iu).optional(),
  defaultModel: z.string().optional(),
  executionPolicy: z.enum(['ask', 'allowlist', 'review', 'autonomous']).default('ask'),
  approvalMode: z.enum(['auto', 'ask']).default('auto'),
  browser: browserSettingsSchema.default({}),
  computer: computerSettingsSchema.default({}),
  sandbox: sandboxSettingsSchema.default({}),
  notifications: z.boolean().default(true),
  telemetry: z.boolean().default(false),
  keyboardShortcuts: z.record(z.string().min(1).max(80), z.string().max(80).nullable()).default({}),
  terminalShell: z.enum(['powershell', 'cmd', 'git-bash']).default('powershell'),
  terminalPlacement: z.enum(['bottom', 'right']).default('bottom'),
  terminalFontSize: z.number().int().min(8).max(24).default(13),
  terminalScrollback: z.number().int().min(100).max(100_000).default(10_000),
  terminalCursorBlink: z.boolean().default(true),
  defaultFileOpenDestination: fileOpenDestinationSchema.default(DEFAULT_FILE_OPEN_DESTINATION),
  showContextWindowUsage: z.boolean().default(false),
});
export type DesktopSettings = z.infer<typeof settingsSchema>;
const defaultSettings: DesktopSettings = settingsSchema.parse({});

export class SettingsService {
  private readonly store = new JsonFileStore<DesktopSettings>(desktopDataPath('settings.json'), defaultSettings, value => settingsSchema.parse(value));
  async get(): Promise<DesktopSettings> { return settingsSchema.parse(await this.store.read()); }
  async update(patch: Partial<DesktopSettings>): Promise<DesktopSettings> { return this.store.update(current => settingsSchema.parse({ ...current, ...patch })); }
}
