import type { DesktopDocumentFormat, DesktopHostCapability } from '../../contracts/agent-protocol/v1/host-capabilities.js';
import { operationsForDocumentFormat } from '../host/host-operation-catalog.js';
import type { DocumentFormat } from './document-constants.js';
import type { PortableDocumentCommands } from './portable-document-command-resolver.js';

/** Derives portable capabilities from the single Desktop operation inventory. */
export function buildPortableDocumentCapabilities(provider: string, commands: PortableDocumentCommands): Partial<Record<DesktopDocumentFormat, DesktopHostCapability>> {
  return {
    pdf: capability(provider, 'pdf', commands),
    pptx: capability(provider, 'pptx', commands),
    excel: capability(provider, 'excel', commands),
    docs: capability(provider, 'docs', commands),
  };
}

function capability(provider: string, format: DocumentFormat, commands: PortableDocumentCommands): DesktopHostCapability {
  return { available: true, provider, operations: operationsForDocumentFormat(format).filter(operation => supports(operation, commands)) };
}

function supports(operation: string, commands: PortableDocumentCommands): boolean {
  const format = operation.split('.', 1)[0];
  const action = operation.split('.', 2)[1];
  if (action !== undefined && ['open', 'inspect', 'validate', 'save', 'close'].includes(action)) return true;
  if (format === 'pdf') return supportsPdf(operation, commands);
  return commands.officeBridge !== undefined;
}

function supportsPdf(operation: string, commands: PortableDocumentCommands): boolean {
  if (operation === 'pdf.open' || operation === 'pdf.create' || operation === 'pdf.inspect' || operation === 'pdf.validate' || operation === 'pdf.save' || operation === 'pdf.close') return true;
  if (operation === 'pdf.readText' || operation === 'pdf.extractTables' || operation === 'pdf.search') return commands.pdfText !== undefined;
  if (operation === 'pdf.render') return commands.pdfRender !== undefined;
  if (operation === 'pdf.recognizeText') return commands.pdfRender !== undefined && commands.pdfOcr !== undefined;
  if (operation === 'pdf.extractImages') return commands.pdfImages !== undefined;
  if (operation === 'pdf.extractLinks') return commands.pdfLinks !== undefined;
  if (operation === 'pdf.extractAnnotations' || operation === 'pdf.manageBookmarks' || operation === 'pdf.flattenForms' || operation === 'pdf.readForm' || operation === 'pdf.fillForm') return commands.pdfToolkit !== undefined;
  if (operation === 'pdf.manageAttachments') return commands.pdfAttachments !== undefined || commands.pdfToolkit !== undefined || commands.pdfQpdf !== undefined;
  if (operation === 'pdf.optimize') return commands.pdfOptimizer !== undefined;
  if (operation === 'pdf.addPageNumbers' || operation === 'pdf.insertPages' || operation === 'pdf.deletePages' || operation === 'pdf.reorderPages' || operation === 'pdf.rotatePages' || operation === 'pdf.split') return commands.pdfToolkit !== undefined && commands.pdfInfo !== undefined;
  if (operation === 'pdf.merge') return commands.pdfMerge !== undefined;
  if (operation === 'pdf.addText' || operation === 'pdf.addImage' || operation === 'pdf.annotate') return commands.pdfEditor !== undefined;
  if (operation === 'pdf.redact') return commands.pdfRedact !== undefined;
  return false;
}
