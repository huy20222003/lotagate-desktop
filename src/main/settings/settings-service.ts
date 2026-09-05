import { z } from 'zod';
import { JsonFileStore } from '../persistence/json-file-store.js';
import { desktopDataPath } from '../persistence/app-data-paths.js';
import { normalizeOriginAllowlist } from '../../contracts/ipc/v1/origin-allowlist.js';
import { DEFAULT_COMPUTER_APPLICATION_ALLOWLIST, normalizeComputerApplicationAllowlist } from '../../contracts/ipc/v1/computer-application-allowlist.js';

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

const sandboxSettingsSchema = z.object({
  backend: z.enum(['auto', 'docker', 'podman', 'disabled']).default('auto'),
  image: z.string().trim().min(1).max(256).default('node:22-bookworm-slim'),
  networkPolicy: z.enum(['none', 'full']).default('none'),
  mountMode: z.enum(['read-only', 'read-write']).default('read-write'),
  memoryMb: z.number().int().min(128).max(16_384).default(2_048),
  cpuCores: z.number().min(0.25).max(16).default(2),
  pidsLimit: z.number().int().min(16).max(4_096).default(128),
  hostFallback: z.enum(['ask', 'allow', 'deny']).default('ask'),
  cleanup: z.enum(['always', 'on-success']).default('always'),
  diagnosticsRetentionDays: z.number().int().min(1).max(365).default(30),
});

const computerSettingsSchema = z.object({
  applicationAllowlist: z.array(z.string().trim().min(1).max(4_096)).default([...DEFAULT_COMPUTER_APPLICATION_ALLOWLIST]).transform(normalizeComputerApplicationAllowlist).pipe(z.array(z.string().min(1).max(4_096)).max(256)),
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
});
export type DesktopSettings = z.infer<typeof settingsSchema>;
const defaultSettings: DesktopSettings = settingsSchema.parse({});

export class SettingsService {
  private readonly store = new JsonFileStore<DesktopSettings>(desktopDataPath('settings.json'), defaultSettings, value => settingsSchema.parse(value));
  async get(): Promise<DesktopSettings> { return settingsSchema.parse(await this.store.read()); }
  async update(patch: Partial<DesktopSettings>): Promise<DesktopSettings> { return this.store.update(current => settingsSchema.parse({ ...current, ...patch })); }
}
