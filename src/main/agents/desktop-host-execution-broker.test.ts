import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DesktopHostExecutionBroker } from './desktop-host-execution-broker.js';
import type { DesktopHostRequest } from '../../contracts/agent-protocol/v1/desktop.js';
import type { SandboxExecutionProvider } from './sandbox-execution-provider.js';
import { SandboxUnavailableError } from './sandbox-execution-provider.js';

const POWER_SHELL_TEST_TIMEOUT_MS = 60_000;

function request(tool: DesktopHostRequest['tool'], action: string, params: Record<string, unknown>, boundary: DesktopHostRequest['executionBoundary'] = 'host', hostFallback: DesktopHostRequest['hostFallback'] = 'deny'): DesktopHostRequest {
  return { version: 1, type: 'host.request', requestId: `request-${action}`, tool, sessionId: 'session-1', runId: 'run-1', action, params, executionBoundary: boundary, hostFallback };
}

describe('DesktopHostExecutionBroker', () => {
  it('reads and writes only inside the workspace boundary', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lotagate-host-broker-'));
    try {
      const broker = new DesktopHostExecutionBroker();
      const write = await broker.handle(root, request('filesystem', 'filesystem.write', { path: 'notes.txt', content: 'hello' }));
      expect(write).toMatchObject({ ok: true, result: 'Wrote 5 bytes.' });
      expect(await readFile(join(root, 'notes.txt'), 'utf8')).toBe('hello');
      const read = await broker.handle(root, request('filesystem', 'filesystem.read', { path: 'notes.txt' }));
      expect(read).toMatchObject({ ok: true, result: 'hello' });
      const outside = await broker.handle(root, request('filesystem', 'filesystem.read', { path: '../outside.txt' }));
      expect(outside).toMatchObject({ ok: false, error: { code: 'HOST_EXECUTION_FAILED' } });
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('rejects writes through a workspace symlink', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lotagate-host-symlink-root-'));
    const outside = await mkdtemp(join(tmpdir(), 'lotagate-host-symlink-outside-'));
    try {
      const outsideFile = join(outside, 'outside.txt');
      await writeFile(outsideFile, 'original', 'utf8');
      await symlink(outside, join(root, 'linked'), process.platform === 'win32' ? 'junction' : undefined);
      const broker = new DesktopHostExecutionBroker();

      const result = await broker.handle(root, request('filesystem', 'filesystem.write', { path: 'linked/outside.txt', content: 'must not escape' }));

      expect(result).toMatchObject({ ok: false, error: { code: 'HOST_EXECUTION_FAILED' } });
      expect(await readFile(outsideFile, 'utf8')).toBe('original');
    } finally {
      await Promise.all([rm(root, { recursive: true, force: true }), rm(outside, { recursive: true, force: true })]);
    }
  });

  it('lists the workspace root when the filesystem list path is omitted', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lotagate-host-list-default-'));
    try {
      await writeFile(join(root, 'README.md'), 'workspace file', 'utf8');
      const broker = new DesktopHostExecutionBroker();
      const result = await broker.handle(root, request('filesystem', 'filesystem.list', {}));
      expect(result).toMatchObject({ ok: true, result: [{ name: 'README.md', kind: 'file' }] });
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('runs structured host commands without shell interpolation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lotagate-host-broker-'));
    try {
      const broker = new DesktopHostExecutionBroker();
      const result = await broker.handle(root, request('shell', 'shell.exec', { command: process.execPath, args: ['-e', "process.stdout.write('ok')"] }));
      expect(result).toMatchObject({ ok: true, result: { stdout: 'ok', exitCode: 0, timedOut: false } });
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('runs a structured PowerShell script without shell interpolation', async () => {
    if (process.platform !== 'win32') return;
    const root = await mkdtemp(join(tmpdir(), 'lotagate-host-broker-powershell-'));
    try {
      const broker = new DesktopHostExecutionBroker();
      const result = await broker.handle(root, request('shell', 'shell.exec', { command: 'powershell.exe', script: 'Write-Output ok' }));
      expect(result).toMatchObject({ ok: true, result: { stdout: expect.stringContaining('ok'), exitCode: 0, timedOut: false } });
    } finally { await rm(root, { recursive: true, force: true }); }
  }, POWER_SHELL_TEST_TIMEOUT_MS);

  it('executes sandbox requests through the provider and reports a controlled fallback', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lotagate-host-broker-'));
    try {
      const provider: SandboxExecutionProvider = { execute: async input => ({ result: `sandbox:${input.action}` }) };
      const broker = new DesktopHostExecutionBroker({ sandbox: provider });
      await expect(broker.handle(root, request('shell', 'shell.exec', { command: 'node' }, 'sandbox'))).resolves.toMatchObject({ ok: true, executionBoundary: 'sandbox', result: 'sandbox:shell.exec' });
      const unavailable = new DesktopHostExecutionBroker({ sandbox: { execute: async () => { throw new SandboxUnavailableError('Sandbox runtime unavailable.'); } } });
      await expect(unavailable.handle(root, request('shell', 'shell.exec', { command: 'node' }, 'sandbox', 'ask'))).resolves.toMatchObject({ ok: false, executionBoundary: 'sandbox', error: { code: 'SANDBOX_FALLBACK_REQUIRED', retryable: true } });
      await expect(unavailable.handle(root, request('shell', 'shell.exec', { command: 'node' }, 'sandbox', 'deny'))).resolves.toMatchObject({ ok: false, error: { code: 'SANDBOX_UNAVAILABLE', retryable: false } });
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
