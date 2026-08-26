import { z } from 'zod';
import { JsonFileStore } from '../persistence/json-file-store.js';
import { desktopDataPath } from '../persistence/app-data-paths.js';

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
  notifications: z.boolean().default(true),
  telemetry: z.boolean().default(false),
  keyboardShortcuts: z.record(z.string().min(1).max(80), z.string().max(80).nullable()).default({}),
});
export type DesktopSettings = z.infer<typeof settingsSchema>;

export class SettingsService {
  private readonly store = new JsonFileStore<DesktopSettings>(desktopDataPath('settings.json'), settingsSchema.parse({}), value => settingsSchema.parse(value));
  async get(): Promise<DesktopSettings> { return settingsSchema.parse(await this.store.read()); }
  async update(patch: Partial<DesktopSettings>): Promise<DesktopSettings> { return this.store.update(current => settingsSchema.parse({ ...current, ...patch })); }
}
