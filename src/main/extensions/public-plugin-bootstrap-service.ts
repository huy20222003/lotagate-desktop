import { z } from 'zod';
import { desktopDataPath } from '../persistence/app-data-paths.js';
import { JsonFileStore } from '../persistence/json-file-store.js';
import type { DesktopLogger } from '../observability/desktop-logger.js';
import { BOOTSTRAP_PLUGINS } from './extension-constants.js';

const bootstrapStateSchema = z.object({
  completed: z.boolean().default(false),
  completedAt: z.string().datetime().optional(),
});

type BootstrapState = z.infer<typeof bootstrapStateSchema>;

interface BootstrapStore {
  read(): Promise<BootstrapState>;
  write(value: BootstrapState): Promise<void>;
}

interface CommandResult {
  content: string;
  structured?: Record<string, unknown>;
}

interface CommandClient {
  commandExecuteResult(cwd: string, input: { actionId: string; positionals: string[]; options: Record<string, string | boolean> }): Promise<CommandResult>;
}

interface PublicPluginSourceResolver {
  resolvePublicPluginSource(name: string): Promise<string>;
}

/** Installs bundled public plugins once, without restoring plugins removed by the user later. */
export class PublicPluginBootstrapService {
  private readonly store: BootstrapStore;
  private readonly now: () => string;
  private readonly shouldStop: () => boolean;

  constructor(
    private readonly sources: PublicPluginSourceResolver,
    private readonly commands: CommandClient,
    private readonly logger: Pick<DesktopLogger, 'info' | 'warn'>,
    private readonly cwd: string,
    store?: BootstrapStore,
    now: () => string = () => new Date().toISOString(),
    shouldStop: () => boolean = () => false,
  ) {
    this.store = store ?? new JsonFileStore<BootstrapState>(desktopDataPath('public-plugin-bootstrap.json'), { completed: false }, value => bootstrapStateSchema.parse(value));
    this.now = now;
    this.shouldStop = shouldStop;
  }

  async run(): Promise<void> {
    const state = await this.store.read();
    if (state.completed) return;

    let attempted = 0;
    let installed = 0;
    let inspectionSucceeded = true;
    let cancelled = false;
    try {
      if (this.shouldStop()) { cancelled = true; return; }
      const result = await this.commands.commandExecuteResult(this.cwd, { actionId: 'plugin.list', positionals: [], options: {} });
      const installedPlugins = readInstalledPluginNames(result.structured);
      for (const pluginName of BOOTSTRAP_PLUGINS) {
        if (this.shouldStop()) { cancelled = true; return; }
        if (installedPlugins.has(pluginName)) continue;
        attempted += 1;
        try {
          const source = await this.sources.resolvePublicPluginSource(pluginName);
          await this.commands.commandExecuteResult(this.cwd, { actionId: 'plugin.install', positionals: [source], options: { scope: 'user' } });
          installed += 1;
          this.logger.info('public.plugins.bootstrap.installed', { name: pluginName });
        } catch (error) {
          this.logger.warn('public.plugins.bootstrap.install.failed', { name: pluginName, message: error instanceof Error ? error.message : 'Unable to install bundled public plugin.' });
        }
      }
    } catch (error) {
      inspectionSucceeded = false;
      this.logger.warn('public.plugins.bootstrap.failed', { message: error instanceof Error ? error.message : 'Unable to inspect bundled public plugins.' });
    } finally {
      if (cancelled) this.logger.info('public.plugins.bootstrap.cancelled', { attempted, installed });
      else if (inspectionSucceeded && attempted === installed) await this.complete(attempted, installed);
      else this.logger.warn('public.plugins.bootstrap.incomplete', { attempted, installed });
    }
  }

  private async complete(attempted: number, installed: number): Promise<void> {
    try {
      await this.store.write({ completed: true, completedAt: this.now() });
    } catch (error) {
      this.logger.warn('public.plugins.bootstrap.state.failed', { message: error instanceof Error ? error.message : 'Unable to persist public plugin bootstrap state.' });
    }
    this.logger.info('public.plugins.bootstrap.completed', { attempted, installed });
  }
}

function readInstalledPluginNames(value: Record<string, unknown> | undefined): ReadonlySet<string> {
  if (value?.['kind'] !== 'plugin' || !Array.isArray(value['items'])) throw new Error('The CLI returned an invalid plugin list.');
  const names = value['items'].flatMap(item => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) return [];
    const name = (item as Record<string, unknown>)['name'];
    return typeof name === 'string' && name.length > 0 ? [name] : [];
  });
  if (names.length !== value['items'].length) throw new Error('The CLI returned an incomplete plugin list.');
  return new Set(names);
}
