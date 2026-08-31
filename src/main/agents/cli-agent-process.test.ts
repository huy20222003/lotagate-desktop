import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock('node:child_process', () => ({ spawn: mocks.spawn }));

import { CliAgentProcess } from './cli-agent-process.js';

function createChild(): EventEmitter & Record<string, unknown> {
  const child = new EventEmitter() as EventEmitter & Record<string, unknown>;
  const close = () => { child['killed'] = true; child['exitCode'] = 1; child.emit('close', 1, null); };
  child['pid'] = 42;
  child['exitCode'] = null;
  child['signalCode'] = null;
  child['killed'] = false;
  child['stdin'] = { write: vi.fn(() => true) };
  child['stdout'] = new EventEmitter();
  child['stderr'] = new EventEmitter();
  child['kill'] = vi.fn(close);
  return child;
}

describe('CliAgentProcess request lifecycle', () => {
  it('rejects a request and terminates the sidecar when no response arrives', async () => {
    vi.useFakeTimers();
    const child = createChild();
    mocks.spawn.mockReturnValueOnce(child);
    const agent = new CliAgentProcess({ cwd: 'C:\\workspace', executable: 'lotagate' }, { onEvent: vi.fn() });

    const pending = agent.request('model.list', {});
    const rejection = expect(pending).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(30_000);

    await rejection;
    expect(child['kill']).toHaveBeenCalled();
    vi.useRealTimers();
  });
});
