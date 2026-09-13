import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { VmSandboxExecutionProvider } from './vm-sandbox-execution-provider.js';
import type { VmRuntimeAdapter, VmRuntimeEnvironment, VmRuntimeStartInput, VmSandboxOptions } from './vm-types.js';

const options = (runner: string): VmSandboxOptions => ({
  runtime: 'wsl2', distribution: 'Ubuntu', profile: 'general', networkPolicy: 'none', allowedDomains: [], workspaceAccess: 'read-write', memoryMb: 2_048, cpuCores: 2, pidsLimit: 128, diskMb: 8_192, maxConcurrentEnvironments: 2, maxConcurrentOperations: 2, idleTimeoutMinutes: 15, guestRunnerPath: runner,
});

describe('VmSandboxExecutionProvider', () => {
  it('reuses one warm guest environment for repeated workspace operations', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lotagate-vm-provider-'));
    try {
      const execute = vi.fn(async () => ({ result: 'sandbox-ok' }));
      const runtime: VmRuntimeAdapter = { inspect: vi.fn(), start: vi.fn(async (_input: VmRuntimeStartInput): Promise<VmRuntimeEnvironment> => ({ execute, close: vi.fn(async () => undefined) })) };
      const provider = new VmSandboxExecutionProvider(() => options(join(root, 'guest-runner.py')), runtime);

      await expect(provider.execute({ root, action: 'filesystem.list', params: {} })).resolves.toMatchObject({ result: 'sandbox-ok' });
      await expect(provider.execute({ root, action: 'filesystem.exists', params: {} })).resolves.toMatchObject({ result: 'sandbox-ok' });

      expect(runtime.start).toHaveBeenCalledTimes(1);
      expect(execute).toHaveBeenCalledTimes(2);
      await provider.closeAll();
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('passes read-only workspace policy to the guest write boundary', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lotagate-vm-readonly-'));
    try {
      const execute = vi.fn(async (input: { params: Record<string, unknown> }) => ({ result: input.params['__readOnly'] === true ? 'blocked-by-guest' : 'unsafe' }));
      const runtime: VmRuntimeAdapter = { inspect: vi.fn(), start: vi.fn(async (): Promise<VmRuntimeEnvironment> => ({ execute, close: vi.fn(async () => undefined) })) };
      const provider = new VmSandboxExecutionProvider(() => ({ ...options(join(root, 'guest-runner.py')), workspaceAccess: 'read-only' } as VmSandboxOptions), runtime);

      await expect(provider.execute({ root, action: 'filesystem.write', params: { path: 'notes.txt', content: 'nope' } })).resolves.toMatchObject({ result: 'blocked-by-guest' });
      expect(execute.mock.calls[0]?.[0].params).toMatchObject({ __readOnly: true });
      await provider.closeAll();
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('waits for capacity instead of starting more environments than configured', async () => {
    const roots = await Promise.all([mkdtemp(join(tmpdir(), 'lotagate-vm-capacity-')), mkdtemp(join(tmpdir(), 'lotagate-vm-capacity-'))]);
    try {
      let releaseFirst!: () => void;
      const firstFinished = new Promise<void>(resolve => { releaseFirst = resolve; });
      const starts: string[] = [];
      const runtime: VmRuntimeAdapter = { inspect: vi.fn(), start: vi.fn(async (input: VmRuntimeStartInput): Promise<VmRuntimeEnvironment> => {
        starts.push(input.root);
        return { execute: starts.length === 1 ? async () => { await firstFinished; return { result: 'first' }; } : async () => ({ result: 'second' }), close: vi.fn(async () => undefined) };
      }) };
      const provider = new VmSandboxExecutionProvider(() => ({ ...options(join(roots[0]!, 'guest-runner.py')), maxConcurrentEnvironments: 1 } as VmSandboxOptions), runtime);
      const first = provider.execute({ root: roots[0]!, action: 'filesystem.list', params: {} });
      await vi.waitFor(() => expect(runtime.start).toHaveBeenCalledTimes(1));
      const second = provider.execute({ root: roots[1]!, action: 'filesystem.list', params: {} });
      await new Promise(resolve => setTimeout(resolve, 10));
      expect(runtime.start).toHaveBeenCalledTimes(1);
      releaseFirst();
      await expect(first).resolves.toMatchObject({ result: 'first' });
      await expect(second).resolves.toMatchObject({ result: 'second' });
      expect(starts).toHaveLength(2);
      await provider.closeAll();
    } finally { await Promise.all(roots.map(root => rm(root, { recursive: true, force: true }))); }
  });

  it('discards a guest after timeout so the next operation starts cleanly', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lotagate-vm-restart-'));
    try {
      const closes: Array<ReturnType<typeof vi.fn>> = [];
      let startCount = 0;
      const runtime: VmRuntimeAdapter = { inspect: vi.fn(), start: vi.fn(async (): Promise<VmRuntimeEnvironment> => {
        startCount += 1;
        const close = vi.fn(async () => undefined);
        closes.push(close);
        return { execute: startCount === 1 ? async () => { throw new Error('VM guest execution timed out after 100ms.'); } : async () => ({ result: 'recovered' }), close };
      }) };
      const provider = new VmSandboxExecutionProvider(() => options(join(root, 'guest-runner.py')), runtime);

      await expect(provider.execute({ root, action: 'shell.exec', params: {} })).rejects.toThrow('timed out');
      await expect(provider.execute({ root, action: 'shell.exec', params: {} })).resolves.toMatchObject({ result: 'recovered' });
      expect(runtime.start).toHaveBeenCalledTimes(2);
      expect(closes[0]).toHaveBeenCalledTimes(1);
      await provider.closeAll();
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
