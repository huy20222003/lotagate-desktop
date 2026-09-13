import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { SandboxExecutionProvider } from '../sandbox/vm-sandbox-execution-provider.js';
import { SandboxUnavailableError } from '../sandbox/vm-sandbox-execution-provider.js';
import { VmDocumentBackend } from './vm-document-backend.js';

describe('VmDocumentBackend', () => {
  it('maps workspace paths into the guest namespace and restores result paths', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lotagate-vm-document-'));
    try {
      const canonicalRoot = await realpath(root);
      await writeFile(join(root, 'report.pdf'), '%PDF-1.7\n', 'utf8');
      const execute = vi.fn(async (_input: { root: string; params: Record<string, unknown> }) => ({ result: { path: '/workspace/output.pdf', text: '/workspace/should-remain-content' }, fileChange: undefined }));
      const backend = new VmDocumentBackend({ execute } as unknown as SandboxExecutionProvider);

      await expect(backend.execute(root, { action: 'pdf.inspect', path: join(root, 'report.pdf'), params: { outputPath: join(root, 'output.pdf') } })).resolves.toEqual({ path: join(canonicalRoot, 'output.pdf'), text: '/workspace/should-remain-content' });
      expect(execute).toHaveBeenCalledWith(expect.objectContaining({ root: canonicalRoot, action: 'pdf.inspect', params: expect.objectContaining({ __path: '/workspace/report.pdf', outputPath: '/workspace/output.pdf' }) }));
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('classifies missing guest document dependencies as sandbox-unavailable', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lotagate-vm-document-'));
    try {
      const execute = vi.fn(async () => { throw new Error('VM_DOCUMENT_UNAVAILABLE: PDF text extraction requires pdftotext.'); });
      const backend = new VmDocumentBackend({ execute } as unknown as SandboxExecutionProvider);

      await expect(backend.execute(root, { action: 'pdf.readText', path: 'report.pdf', params: {} })).rejects.toBeInstanceOf(SandboxUnavailableError);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
