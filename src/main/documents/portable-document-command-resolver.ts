import { commandAvailable, firstAvailableCommand } from '../process/command-availability.js';

export interface PortableDocumentCommands {
  readonly office?: string;
  readonly officeBridge?: { command: string; scriptPath: string };
  readonly pdfInfo?: string;
  readonly pdfText?: string;
  readonly pdfRender?: string;
  readonly pdfMerge?: string;
  readonly pdfImages?: string;
  readonly pdfLinks?: string;
  readonly pdfAttachments?: string;
  readonly pdfToolkit?: string;
  readonly pdfQpdf?: string;
  readonly pdfOptimizer?: string;
  readonly pdfOcr?: string;
  /** In-process editor supplied by the Desktop PDF adapter. */
  readonly pdfEditor?: 'embedded';
  /** Raster redaction supplied by the Desktop PDF adapter. */
  readonly pdfRedact?: 'rendered';
}

/** Resolves optional native document helpers without invoking a shell. */
export async function resolvePortableDocumentCommands(): Promise<PortableDocumentCommands> {
  const [office, pdfInfo, pdfText, pdfRender, pdfMerge, pdfImages, pdfLinks, pdfAttachments, pdfToolkit, pdfQpdf, pdfOptimizer, pdfOcr] = await Promise.all([
    firstAvailableCommand(['soffice', 'libreoffice']),
    commandAvailable('pdfinfo'), commandAvailable('pdftotext'), commandAvailable('pdftoppm'), commandAvailable('pdfunite'),
    commandAvailable('pdfimages'), commandAvailable('pdftohtml'), commandAvailable('pdfdetach'), commandAvailable('pdftk'), commandAvailable('qpdf'), firstAvailableCommand(['gs', 'gswin64c']), commandAvailable('tesseract'),
  ]);
  return {
    pdfEditor: 'embedded',
    ...(pdfInfo && pdfRender ? { pdfRedact: 'rendered' as const } : {}),
    ...(office === undefined ? {} : { office }),
    ...(pdfInfo ? { pdfInfo: 'pdfinfo' } : {}),
    ...(pdfText ? { pdfText: 'pdftotext' } : {}),
    ...(pdfRender ? { pdfRender: 'pdftoppm' } : {}),
    ...(pdfMerge ? { pdfMerge: 'pdfunite' } : {}),
    ...(pdfImages ? { pdfImages: 'pdfimages' } : {}),
    ...(pdfLinks ? { pdfLinks: 'pdftohtml' } : {}),
    ...(pdfAttachments ? { pdfAttachments: 'pdfdetach' } : {}),
    ...(pdfToolkit ? { pdfToolkit: 'pdftk' } : {}),
    ...(pdfQpdf ? { pdfQpdf: 'qpdf' } : {}),
    ...(pdfOptimizer === undefined ? {} : { pdfOptimizer }),
    ...(pdfOcr ? { pdfOcr: 'tesseract' } : {}),
  };
}
