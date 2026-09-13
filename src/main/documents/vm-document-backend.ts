import { realpath } from 'node:fs/promises';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import type { DesktopDocumentFormat, DesktopHostCapability } from '../../contracts/agent-protocol/v1/host-capabilities.js';
import { DOCUMENT_BACKEND_TIMEOUT_MS } from './document-constants.js';
import type { DocumentBackend, DocumentBackendInput } from './document-backend.js';
import { buildPortableDocumentCapabilities } from './portable-document-capabilities.js';
import type { PortableDocumentCommands } from './portable-document-command-resolver.js';
import type { SandboxExecutionProvider } from '../sandbox/vm-sandbox-execution-provider.js';
import { SandboxUnavailableError } from '../sandbox/vm-sandbox-execution-provider.js';

/** Runs the existing portable document backend inside the configured OS sandbox. */
export class VmDocumentBackend implements DocumentBackend {
  readonly id = 'isolated-document-runtime';
  readonly capabilities: Partial<Record<DesktopDocumentFormat, DesktopHostCapability>>;

  constructor(private readonly sandbox: SandboxExecutionProvider, commands: PortableDocumentCommands = guestDocumentCommands()) {
    this.capabilities = buildPortableDocumentCapabilities(this.id, commands);
  }

  async execute(cwd: string, input: DocumentBackendInput, signal?: AbortSignal): Promise<unknown> {
    const root = await realpath(cwd);
    const path = await toGuestPath(root, input.path);
    const params = await mapDocumentParams(root, input.params);
    try {
      const result = await this.sandbox.execute({ root, action: input.action, params: { ...params, __path: path }, timeoutMs: DOCUMENT_BACKEND_TIMEOUT_MS, ...(signal === undefined ? {} : { signal }) });
      return restoreGuestPaths(result.result, root);
    } catch (error) {
      if (error instanceof SandboxUnavailableError) throw error;
      const message = error instanceof Error ? error.message : String(error);
      if (message.startsWith('VM_DOCUMENT_UNAVAILABLE:')) throw new SandboxUnavailableError(message.slice('VM_DOCUMENT_UNAVAILABLE:'.length).trim());
      throw error;
    }
  }
}

/** The guest image catalog owns these standard command names. Health checks run when the VM is provisioned. */
export function guestDocumentCommands(): PortableDocumentCommands {
  return {
    office: 'libreoffice',
    officeBridge: { command: 'python3', scriptPath: '/opt/lotagate/document-use/portable-office-bridge.py' },
    pdfInfo: 'pdfinfo',
    pdfText: 'pdftotext',
    pdfRender: 'pdftoppm',
    pdfMerge: 'pdfunite',
    pdfImages: 'pdfimages',
    pdfLinks: 'pdftohtml',
    pdfAttachments: 'pdfdetach',
    pdfToolkit: 'pdftk',
    pdfQpdf: 'qpdf',
    pdfOptimizer: 'gs',
    pdfOcr: 'tesseract',
    pdfEditor: 'embedded',
    pdfRedact: 'rendered',
  };
}

async function mapDocumentParams(root: string, input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const params = { ...input };
  for (const key of ['sourcePath', 'imagePath', 'mediaPath', 'outputPath'] as const) {
    if (typeof params[key] === 'string') params[key] = await toGuestPath(root, params[key] as string);
  }
  if (Array.isArray(params['paths'])) params['paths'] = await Promise.all((params['paths'] as unknown[]).map(async value => typeof value === 'string' ? toGuestPath(root, value) : value));
  return params;
}

async function toGuestPath(root: string, value: string): Promise<string> {
  const candidate = resolve(root, value);
  const canonicalCandidate = await canonicalizePath(candidate);
  const relativePath = relative(root, canonicalCandidate);
  if (isAbsolute(relativePath) || relativePath === '..' || relativePath.startsWith(`..${sep}`)) throw new Error('The document path is outside the VM workspace boundary.');
  return `/workspace/${relativePath.replaceAll(sep, '/')}`;
}

async function canonicalizePath(candidate: string): Promise<string> {
  try { return await realpath(candidate); }
  catch {
    return resolve(await realpath(dirname(candidate)), basename(candidate));
  }
}

const GUEST_PATH_KEYS = new Set(['path', 'sourcePath', 'imagePath', 'mediaPath', 'outputPath', 'files', 'paths']);

function restoreGuestPaths(value: unknown, root: string, depth = 0, key?: string): unknown {
  if (depth > 8 || value === null || value === undefined) return value;
  if (typeof value === 'string' && key !== undefined && GUEST_PATH_KEYS.has(key)) {
    if (value === '/workspace') return root;
    if (value.startsWith('/workspace/')) return resolve(root, value.slice('/workspace/'.length));
    return value;
  }
  if (Array.isArray(value)) return value.map(item => restoreGuestPaths(item, root, depth + 1, key));
  if (typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([childKey, item]) => [childKey, restoreGuestPaths(item, root, depth + 1, childKey)]));
}
