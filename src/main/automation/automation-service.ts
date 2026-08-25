import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { JsonFileStore } from '../persistence/json-file-store.js';
import { desktopDataPath } from '../persistence/app-data-paths.js';

const automationSchema = z.object({ id: z.string(), name: z.string().min(1), workspaceId: z.string(), prompt: z.string().min(1), schedule: z.string().min(1), executionPolicy: z.enum(['ask', 'allowlist', 'review', 'autonomous']), enabled: z.boolean(), nextRunAt: z.string().datetime().nullable(), lastRunAt: z.string().datetime().nullable(), lastError: z.string().nullable() });
export type Automation = z.infer<typeof automationSchema>;
export type AutomationRunner = (automation: Automation) => Promise<void>;

export class AutomationService {
  private readonly store = new JsonFileStore<Automation[]>(desktopDataPath('automations.json'), []);
  private timer: ReturnType<typeof setInterval> | undefined;
  async list(): Promise<Automation[]> { return this.store.read(); }
  async create(input: Omit<Automation, 'id' | 'enabled' | 'nextRunAt' | 'lastRunAt' | 'lastError'>): Promise<Automation> { const item = automationSchema.parse({ ...input, id: randomUUID(), enabled: true, nextRunAt: next(input.schedule), lastRunAt: null, lastError: null }); await this.store.update(current => [...current, item]); return item; }
  async update(id: string, patch: Partial<Automation>): Promise<Automation> { let updated: Automation | undefined; await this.store.update(current => { const index = current.findIndex(item => item.id === id); if (index < 0) throw new Error('Automation was not found.'); const item = automationSchema.parse({ ...current[index], ...patch, id, ...(patch.schedule === undefined ? {} : { nextRunAt: next(patch.schedule) }) }); const nextItems = [...current]; nextItems[index] = item; updated = item; return nextItems; }); if (!updated) throw new Error('Automation update failed.'); return updated; }
  async remove(id: string): Promise<void> { await this.store.update(current => current.filter(item => item.id !== id)); }
  start(runner: AutomationRunner, pollMs: number): void { this.stop(); this.timer = setInterval(() => { void this.runDue(runner); }, pollMs); }
  stop(): void { if (this.timer !== undefined) { clearInterval(this.timer); this.timer = undefined; } }
  async run(id: string, runner: AutomationRunner): Promise<Automation> { const item = (await this.store.read()).find(value => value.id === id); if (item === undefined) throw new Error('Automation was not found.'); if (!item.enabled) throw new Error('Automation is disabled.'); try { await runner(item); return this.recordRun(item, null); } catch (error) { return this.recordRun(item, error instanceof Error ? error.message : 'Automation failed.'); } }
  private async runDue(runner: AutomationRunner): Promise<void> { const now = Date.now(); for (const item of await this.store.read()) if (item.enabled && item.nextRunAt !== null && Date.parse(item.nextRunAt) <= now) await this.run(item.id, runner); }
  private async recordRun(item: Automation, error: string | null): Promise<Automation> { return this.update(item.id, { lastRunAt: new Date().toISOString(), lastError: error, nextRunAt: next(item.schedule) }); }
}

function next(schedule: string): string | null { const value = Date.parse(schedule); return Number.isNaN(value) ? null : new Date(value).toISOString(); }
