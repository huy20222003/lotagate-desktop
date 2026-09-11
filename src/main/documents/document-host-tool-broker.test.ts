import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { DesktopHostRequest } from '../../contracts/agent-protocol/v1/desktop.js';
import { DocumentHostToolBroker } from './document-host-tool-broker.js';

vi.mock('electron', () => ({ app: { getPath: () => process.env['LOTAGATE_DOCUMENT_TEST_USER_DATA'] ?? process.cwd() } }));

function request(action: string, params: Record<string, unknown>, taskId?: string): DesktopHostRequest {
  return { version: 1, type: 'host.request', requestId: `request-${action}`, tool: 'document', sessionId: 'session-1', runId: 'run-1', action, params, executionBoundary: 'host', hostFallback: 'deny', ...(taskId === undefined ? {} : { taskId }) };
}

describe('DocumentHostToolBroker', () => {
  it('rejects paths whose extension does not belong to the selected plugin', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lotagate-document-broker-'));
    try {
      await writeFile(join(root, 'notes.txt'), 'not a pdf', 'utf8');
      const response = await new DocumentHostToolBroker(join(root, 'backend.ps1')).handle(root, request('pdf.open', { path: 'notes.txt' }));
      expect(response).toMatchObject({ ok: false, tool: 'document', error: { code: 'DOCUMENT_HOST_ERROR' } });
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('accepts an existing isolated execution workspace outside the project root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lotagate-document-broker-'));
    const outside = await mkdtemp(join(tmpdir(), 'lotagate-document-outside-'));
    try {
      const response = await new DocumentHostToolBroker(join(root, 'backend.ps1')).handle(root, request('pdf.validate', { path: 'file.pdf' }), undefined);
      expect(response.ok).toBe(false);
      await writeFile(join(outside, 'file.pdf'), 'pdf placeholder', 'utf8');
      const outsideResponse = await new DocumentHostToolBroker(join(root, 'backend.ps1')).handle(root, { ...request('pdf.validate', { path: 'file.pdf' }), executionCwd: outside });
      expect(outsideResponse).toMatchObject({ ok: false, error: { code: 'DOCUMENT_HOST_ERROR' } });
    } finally { await rm(root, { recursive: true, force: true }); await rm(outside, { recursive: true, force: true }); }
  });

  it('rejects actions outside the negotiated document capability', async () => {
    const backend = { id: 'test-backend', capabilities: { pdf: { available: true, provider: 'test', operations: ['pdf.open'] } }, execute: vi.fn() };
    const root = await mkdtemp(join(tmpdir(), 'lotagate-document-broker-'));
    try {
      const response = await new DocumentHostToolBroker(backend).handle(root, request('pdf.validate', { path: 'file.pdf' }));
      expect(response).toMatchObject({ ok: false, error: { code: 'DOCUMENT_HOST_ERROR' } });
      expect(backend.execute).not.toHaveBeenCalled();
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('publishes created documents as task artifacts and keeps handle updates in the artifact staging area', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lotagate-document-broker-'));
    const userData = await mkdtemp(join(tmpdir(), 'lotagate-document-user-data-'));
    const importFile = vi.fn(async (taskId: string, sourcePath: string, kind: 'binary') => ({ id: 'artifact-1', taskId, name: 'report.docx', path: sourcePath, kind, size: 16, createdAt: new Date().toISOString() }));
    const replaceFile = vi.fn(async (taskId: string, artifactId: string, sourcePath: string) => ({ id: artifactId, taskId, name: 'report.docx', path: sourcePath, kind: 'binary' as const, size: 14, createdAt: new Date().toISOString() }));
    const backend = {
      id: 'artifact-test-backend',
      capabilities: { docs: { available: true, provider: 'test', operations: ['docs.create', 'docs.save'] } },
      execute: vi.fn(async (_cwd: string, input: { action: string; path: string }) => {
        await writeFile(input.path, input.action === 'docs.create' ? 'created document' : 'updated document', 'utf8');
        return { path: input.path, saved: input.action === 'docs.save' };
      }),
    };
    process.env['LOTAGATE_DOCUMENT_TEST_USER_DATA'] = userData;
    try {
      const broker = new DocumentHostToolBroker(backend, { importFile, replaceFile });
      const created = await broker.handle(root, request('docs.create', { path: 'report.docx' }, 'task-1'));
      expect(created).toMatchObject({ ok: true, artifacts: [{ id: 'artifact-1', name: 'report.docx', kind: 'binary' }] });
      const createdPath = backend.execute.mock.calls[0]?.[1].path;
      expect(createdPath).toBeDefined();
      expect(createdPath).not.toContain(root);
      expect(createdPath).toContain(userData);
      expect(importFile).toHaveBeenCalledWith('task-1', createdPath, 'binary');

      const handleId = (created.result as { handleId: string }).handleId;
      const saved = await broker.handle(root, request('docs.save', { handleId }, 'task-1'));
      expect(saved).toMatchObject({ ok: true, artifacts: [{ id: 'artifact-1' }] });
      expect(replaceFile).toHaveBeenCalledWith('task-1', 'artifact-1', createdPath);
      await broker.closeForSession(root, 'session-1');
    } finally {
      delete process.env['LOTAGATE_DOCUMENT_TEST_USER_DATA'];
      await rm(root, { recursive: true, force: true });
      await rm(userData, { recursive: true, force: true });
    }
  });

  it('imports opened workspace documents before allowing artifact-backed edits', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lotagate-document-broker-'));
    const userData = await mkdtemp(join(tmpdir(), 'lotagate-document-user-data-'));
    const source = join(root, 'existing.docx');
    await writeFile(source, 'original document', 'utf8');
    const importFile = vi.fn(async (taskId: string, sourcePath: string, kind: 'binary') => ({ id: 'artifact-open', taskId, name: 'existing.docx', path: sourcePath, kind, size: 17, createdAt: new Date().toISOString() }));
    const replaceFile = vi.fn(async (taskId: string, artifactId: string, sourcePath: string) => ({ id: artifactId, taskId, name: 'existing.docx', path: sourcePath, kind: 'binary' as const, size: 17, createdAt: new Date().toISOString() }));
    const backend = {
      id: 'artifact-open-backend',
      capabilities: { docs: { available: true, provider: 'test', operations: ['docs.open', 'docs.save'] } },
      execute: vi.fn(async (_cwd: string, input: { path: string }) => { await writeFile(input.path, 'updated document', 'utf8'); return { path: input.path }; }),
    };
    process.env['LOTAGATE_DOCUMENT_TEST_USER_DATA'] = userData;
    try {
      const broker = new DocumentHostToolBroker(backend, { importFile, replaceFile });
      const opened = await broker.handle(root, request('docs.open', { path: 'existing.docx' }, 'task-1'));
      expect(opened).toMatchObject({ ok: true, artifacts: [{ id: 'artifact-open', name: 'existing.docx' }] });
      const stagedPath = importFile.mock.calls[0]?.[1];
      expect(stagedPath).toBeDefined();
      expect(stagedPath).not.toContain(root);
      expect(await readFile(source, 'utf8')).toBe('original document');
      const handleId = (opened.result as { handleId: string }).handleId;
      await expect(broker.handle(root, request('docs.save', { handleId }, 'task-1'))).resolves.toMatchObject({ ok: true });
      expect(replaceFile).toHaveBeenCalledWith('task-1', 'artifact-open', stagedPath);
      await broker.closeForSession(root, 'session-1');
    } finally {
      delete process.env['LOTAGATE_DOCUMENT_TEST_USER_DATA'];
      await rm(root, { recursive: true, force: true });
      await rm(userData, { recursive: true, force: true });
    }
  });
});
