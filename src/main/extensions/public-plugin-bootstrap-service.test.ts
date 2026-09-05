import { describe, expect, it, vi } from 'vitest';
import { PublicPluginBootstrapService } from './public-plugin-bootstrap-service.js';

interface TestState {
  completed: boolean;
  completedAt?: string;
}

function createStore(initial: TestState) {
  let state = initial;
  return {
    read: vi.fn(async () => state),
    write: vi.fn(async (next: TestState) => { state = next; }),
  };
}

describe('PublicPluginBootstrapService', () => {
  it('installs only missing bundled plugins and persists the one-time marker', async () => {
    const store = createStore({ completed: false });
    const commands = {
      commandExecuteResult: vi.fn(async (_cwd: string, input: { actionId: string; positionals: string[]; options: Record<string, string | boolean> }) => input.actionId === 'plugin.list'
        ? { content: '', structured: { kind: 'plugin', items: [{ name: 'computer-use' }] } }
        : { content: '' }),
    };
    const sources = { resolvePublicPluginSource: vi.fn(async (name: string) => `C:\\public-plugins\\${name}`) };
    const logger = { info: vi.fn(), warn: vi.fn() };
    const service = new PublicPluginBootstrapService(sources, commands, logger, 'C:\\user-data', store, () => '2026-09-05T12:00:00.000Z');

    await service.run();

    expect(commands.commandExecuteResult).toHaveBeenCalledTimes(2);
    expect(commands.commandExecuteResult).toHaveBeenLastCalledWith('C:\\user-data', { actionId: 'plugin.install', positionals: ['C:\\public-plugins\\browser-use'], options: { scope: 'user' } });
    expect(sources.resolvePublicPluginSource).toHaveBeenCalledOnce();
    expect(store.write).toHaveBeenCalledWith({ completed: true, completedAt: '2026-09-05T12:00:00.000Z' });
  });

  it('does not inspect or reinstall plugins after the bootstrap marker is complete', async () => {
    const store = createStore({ completed: true });
    const commands = { commandExecuteResult: vi.fn() };
    const sources = { resolvePublicPluginSource: vi.fn() };
    const logger = { info: vi.fn(), warn: vi.fn() };
    const service = new PublicPluginBootstrapService(sources, commands, logger, 'C:\\user-data', store);

    await service.run();

    expect(commands.commandExecuteResult).not.toHaveBeenCalled();
    expect(sources.resolvePublicPluginSource).not.toHaveBeenCalled();
  });
});
