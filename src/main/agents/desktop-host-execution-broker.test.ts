import { mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { DesktopHostExecutionBroker } from './desktop-host-execution-broker.js';
import type { DesktopHostRequest } from '../../contracts/agent-protocol/v1/desktop.js';
import type { SandboxExecutionProvider } from '../sandbox/vm-sandbox-execution-provider.js';
import { SandboxUnavailableError } from '../sandbox/vm-sandbox-execution-provider.js';

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

  it('returns false for a missing filesystem.exists target', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lotagate-host-exists-'));
    try {
      const broker = new DesktopHostExecutionBroker();
      const result = await broker.handle(root, request('filesystem', 'filesystem.exists', { path: 'missing/nested.txt' }));
      expect(result).toMatchObject({ ok: true, result: false });
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('creates missing parent directories for filesystem.write', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lotagate-host-write-parent-'));
    try {
      const broker = new DesktopHostExecutionBroker();
      const result = await broker.handle(root, request('filesystem', 'filesystem.write', { path: 'missing/nested.txt', content: 'created' }));
      expect(result).toMatchObject({ ok: true, result: 'Wrote 7 bytes.' });
      expect(await readFile(join(root, 'missing', 'nested.txt'), 'utf8')).toBe('created');
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('publishes a workspace-relative file through the host artifact service', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lotagate-host-artifact-'));
    try {
      await writeFile(join(root, 'report.pdf'), 'pdf bytes', 'utf8');
      const published = { id: 'artifact-1', name: 'report.pdf', kind: 'pdf', sizeBytes: 9 };
      const expectedSourcePath = await realpath(join(root, 'report.pdf'));
      const publisher = { publishFile: async (taskId: string, sourcePath: string) => { expect(taskId).toBe('task-1'); expect(sourcePath).toBe(expectedSourcePath); return published; } };
      const broker = new DesktopHostExecutionBroker({ artifactPublisher: publisher });
      const result = await broker.handle(root, { ...request('artifact', 'artifact.publish', { path: 'report.pdf' }), taskId: 'task-1' });

      expect(result).toMatchObject({ ok: true, executionBoundary: 'host', result: { published: true, artifact: published }, artifacts: [published] });
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

  it('forwards the tool timeout to the sandbox boundary', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lotagate-host-broker-timeout-'));
    try {
      const execute = vi.fn(async () => ({ result: 'sandbox-ok' }));
      const broker = new DesktopHostExecutionBroker({ sandbox: { execute } });
      await broker.handle(root, request('shell', 'shell.exec', { command: 'node', timeoutMs: 90_000 }, 'sandbox'));
      expect(execute).toHaveBeenCalledWith(expect.objectContaining({ timeoutMs: 90_000 }));
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
