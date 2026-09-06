import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { DesktopHostRequest } from '../../contracts/agent-protocol/v1/desktop.js';
import { DocumentHostToolBroker } from './document-host-tool-broker.js';

function request(action: string, params: Record<string, unknown>): DesktopHostRequest {
  return { version: 1, type: 'host.request', requestId: `request-${action}`, tool: 'document', sessionId: 'session-1', runId: 'run-1', action, params, executionBoundary: 'host', hostFallback: 'deny' };
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

  it('rejects document workspaces outside the project root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lotagate-document-broker-'));
    const outside = await mkdtemp(join(tmpdir(), 'lotagate-document-outside-'));
    try {
      const response = await new DocumentHostToolBroker(join(root, 'backend.ps1')).handle(root, request('pdf.validate', { path: 'file.pdf' }), undefined);
      expect(response.ok).toBe(false);
      const outsideResponse = await new DocumentHostToolBroker(join(root, 'backend.ps1')).handle(root, { ...request('pdf.validate', { path: 'file.pdf' }), executionCwd: outside });
      expect(outsideResponse).toMatchObject({ ok: false, error: { code: 'DOCUMENT_PATH_INVALID' } });
    } finally { await rm(root, { recursive: true, force: true }); await rm(outside, { recursive: true, force: true }); }
  });
});
