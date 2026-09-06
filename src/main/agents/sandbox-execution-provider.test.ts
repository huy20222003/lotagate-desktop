import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock('node:child_process', () => ({ spawn: mocks.spawn }));

import { ContainerSandboxExecutionProvider } from './sandbox-execution-provider.js';

describe('ContainerSandboxExecutionProvider', () => {
  it('keeps the container stdin interactive for JSON payload delivery', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lotagate-sandbox-'));
    try {
      const child = new EventEmitter() as EventEmitter & Record<string, unknown>;
      child['stdout'] = new EventEmitter();
      child['stderr'] = new EventEmitter();
      child['stdin'] = { end: vi.fn(() => queueMicrotask(() => { (child['stdout'] as EventEmitter).emit('data', JSON.stringify({ ok: true, result: 'sandbox-ok' })); child.emit('close', 0); })) };
      mocks.spawn.mockReturnValueOnce(child);
      const provider = new ContainerSandboxExecutionProvider({ backend: 'docker', cleanup: 'always' });

      await expect(provider.execute({ root, action: 'filesystem.list', params: {} })).resolves.toMatchObject({ result: 'sandbox-ok' });

      const args = mocks.spawn.mock.calls[0]?.[1] as string[];
      expect(args.slice(0, 2)).toEqual(['run', '--interactive']);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
