import { DOCUMENT_BACKEND_MAX_OUTPUT_BYTES, DOCUMENT_BACKEND_TIMEOUT_MS, DOCUMENT_FORMATS } from './document-constants.js';
import { runBoundedCommand } from '../process/bounded-command.js';
import type { DesktopDocumentFormat, DesktopHostCapability } from '../../contracts/agent-protocol/v1/host-capabilities.js';
import type { DocumentBackend, DocumentBackendInput } from './document-backend.js';
import { operationsForDocumentFormat } from '../host/host-operation-catalog.js';
import { executePdfEditorOperation } from './pdf-editor.js';
import { executePortablePdfOperation } from './portable-pdf-operations.js';
import type { PortableDocumentCommands } from './portable-document-command-resolver.js';
export { DOCUMENT_BACKEND_MAX_OUTPUT_BYTES, DOCUMENT_BACKEND_TIMEOUT_MS } from './document-constants.js';

// Document extraction and Office conversions can legitimately produce larger
// JSON responses and take longer than the generic command execution path.
// Keep both limits bounded while allowing realistic workbooks and documents.

export async function runDocumentBackend(scriptPath: string, cwd: string, input: { action: string; path: string; params: Record<string, unknown> }, signal?: AbortSignal): Promise<unknown> {
  if (process.platform !== 'win32') throw new Error('The document host currently requires the Windows document backend.');
  const result = await runBoundedCommand('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath], {
    cwd,
    input: JSON.stringify({ cwd, ...input }),
    maxOutputBytes: DOCUMENT_BACKEND_MAX_OUTPUT_BYTES,
    timeoutMs: DOCUMENT_BACKEND_TIMEOUT_MS,
    ...(signal === undefined ? {} : { signal }),
  });
  try { return JSON.parse(result.stdout.toString('utf8')); }
  catch { throw new Error('Document backend returned invalid JSON.'); }
}

/** Windows COM/PowerShell adapter retained behind the document backend contract. */
export class PowerShellDocumentBackend implements DocumentBackend {
  readonly id = 'windows-powershell-office';
  readonly capabilities: Partial<Record<DesktopDocumentFormat, DesktopHostCapability>>;

  constructor(private readonly scriptPath: string, private readonly pdfCommands: PortableDocumentCommands = { pdfEditor: 'embedded' }) {
    this.capabilities = Object.fromEntries(DOCUMENT_FORMATS.map(format => [format, { available: true, provider: this.id, operations: operationsForDocumentFormat(format) }])) as Partial<Record<DesktopDocumentFormat, DesktopHostCapability>>;
  }

  async execute(cwd: string, input: DocumentBackendInput, signal?: AbortSignal): Promise<unknown> {
    const [format, operation] = input.action.split('.', 2);
    if (format === 'pdf' && operation !== undefined) {
      const edited = await executePdfEditorOperation({ path: input.path, operation, params: input.params, commands: this.pdfCommands, ...(signal === undefined ? {} : { signal }), run: (command, args, childSignal, maxOutputBytes = DOCUMENT_BACKEND_MAX_OUTPUT_BYTES) => runBoundedCommand(command, args, { maxOutputBytes, timeoutMs: DOCUMENT_BACKEND_TIMEOUT_MS, ...(childSignal === undefined ? {} : { signal: childSignal }) }) });
      if (edited !== undefined) return edited;
      const portable = await executePortablePdfOperation({ path: input.path, operation, params: input.params, commands: this.pdfCommands, ...(signal === undefined ? {} : { signal }), run: (command, args, childSignal, maxOutputBytes = DOCUMENT_BACKEND_MAX_OUTPUT_BYTES) => runBoundedCommand(command, args, { maxOutputBytes, timeoutMs: DOCUMENT_BACKEND_TIMEOUT_MS, ...(childSignal === undefined ? {} : { signal: childSignal }) }) });
      if (portable !== undefined) return portable;
    }
    return runDocumentBackend(this.scriptPath, cwd, input, signal);
  }
}
