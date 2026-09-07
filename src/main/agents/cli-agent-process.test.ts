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
    try {
      const child = createChild();
      mocks.spawn.mockReturnValueOnce(child);
      const agent = new CliAgentProcess({ cwd: 'C:\\workspace', executable: 'lotagate' }, { onEvent: vi.fn() });

      const pending = agent.request('model.list', {});
      const rejection = expect(pending).rejects.toThrow('timed out');
      await vi.advanceTimersByTimeAsync(31_000);

      await rejection;
      expect(child['kill']).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects a request when stdin backpressure never drains', async () => {
    vi.useFakeTimers();
    try {
      const child = createChild();
      const stdin = new EventEmitter() as EventEmitter & Record<string, unknown>;
      stdin['write'] = vi.fn(() => false);
      child['stdin'] = stdin;
      mocks.spawn.mockReturnValueOnce(child);
      const agent = new CliAgentProcess({ cwd: 'C:\\workspace', executable: 'lotagate' }, { onEvent: vi.fn() });

      const pending = agent.request('model.list', {});
      const rejection = expect(pending).rejects.toThrow('timed out');
      await vi.advanceTimersByTimeAsync(31_000);

      await rejection;
      expect(child['kill']).toHaveBeenCalled();
      expect(stdin.listenerCount('drain')).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not let a late host response from an old process generation kill the replacement', async () => {
    const oldChild = createChild();
    const newChild = createChild();
    let newRequestId = '';
    const newStdin = { write: vi.fn((line: string) => { newRequestId = JSON.parse(line).id as string; return true; }) };
    newChild['stdin'] = newStdin;
    mocks.spawn.mockReturnValueOnce(oldChild).mockReturnValueOnce(newChild);
    let resolveHost: (() => void) | undefined;
    const hostCompleted = new Promise<void>(resolve => { resolveHost = resolve; });
    const onHostRequest = vi.fn(async () => { await hostCompleted; return { version: 1 as const, type: 'host.response' as const, requestId: 'host-1', tool: 'filesystem' as const, executionBoundary: 'host' as const, ok: true as const, result: 'old-response' }; });
    const onExit = vi.fn();
    const agent = new CliAgentProcess({ cwd: 'C:\\workspace', executable: 'lotagate' }, { onEvent: vi.fn(), onHostRequest, onExit });
    const oldRequest = agent.request('model.list', {});
    (oldChild['stdout'] as EventEmitter).emit('data', `${JSON.stringify({ version: 1, type: 'host.request', requestId: 'host-1', tool: 'filesystem', sessionId: 'session-1', runId: 'run-1', action: 'filesystem.read', params: { path: 'README.md' }, executionBoundary: 'host', hostFallback: 'deny' })}\n`);
    await vi.waitFor(() => expect(onHostRequest).toHaveBeenCalledOnce());
    oldChild['exitCode'] = 1;
    oldChild.emit('close', 1, null);
    await expect(oldRequest).rejects.toThrow('exited');

    const newRequest = agent.request('model.list', {});
    await vi.waitFor(() => expect(newStdin.write).toHaveBeenCalledOnce());
    resolveHost?.();
    (newChild['stdout'] as EventEmitter).emit('data', `${JSON.stringify({ version: 1, type: 'response', id: newRequestId, method: 'model.list', ok: true, result: 'new-response' })}\n`);

    await expect(newRequest).resolves.toBe('new-response');
    expect(newChild['kill']).not.toHaveBeenCalled();
    expect(onExit).toHaveBeenCalledOnce();
  });
});
