import { z } from 'zod';
import { JsonFileStore } from '../persistence/json-file-store.js';
import { desktopDataPath } from '../persistence/app-data-paths.js';

export const settingsSchema = z.object({
  appearance: z.enum(['dark']).default('dark'),
  language: z.enum(['en', 'vi']).default('en'),
  reducedMotion: z.boolean().default(false),
  defaultModel: z.string().optional(),
  executionPolicy: z.enum(['ask', 'allowlist', 'review', 'autonomous']).default('ask'),
  notifications: z.boolean().default(true),
  telemetry: z.boolean().default(false),
});
export type DesktopSettings = z.infer<typeof settingsSchema>;

export class SettingsService {
  private readonly store = new JsonFileStore<DesktopSettings>(desktopDataPath('settings.json'), settingsSchema.parse({}), value => settingsSchema.parse(value));
  async get(): Promise<DesktopSettings> { return settingsSchema.parse(await this.store.read()); }
  async update(patch: Partial<DesktopSettings>): Promise<DesktopSettings> { return this.store.update(current => settingsSchema.parse({ ...current, ...patch })); }
}
