import { readFile, rm, writeFile, rename, mkdir, mkdtemp } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  PDFArray,
  PDFDocument,
  PDFName,
  PDFString,
  StandardFonts,
  rgb,
} from 'pdf-lib';
import type { BoundedCommandResult } from '../process/bounded-command.js';

export interface PdfEditorCommands {
  readonly pdfInfo?: string;
  readonly pdfRender?: string;
}

export interface PdfEditorContext {
  readonly path: string;
  readonly operation: string;
  readonly params: Record<string, unknown>;
  readonly commands: PdfEditorCommands;
  readonly signal?: AbortSignal;
  readonly run: (command: string, args: readonly string[], signal?: AbortSignal, maxOutputBytes?: number) => Promise<BoundedCommandResult>;
}

/** Executes the cross-platform PDF edits that do not depend on an Office app. */
export async function executePdfEditorOperation(context: PdfEditorContext): Promise<unknown | undefined> {
  if (context.operation === 'redact') return redact(context);
  if (context.operation === 'addText') return updateDocument(context, addText);
  if (context.operation === 'addImage') return updateDocument(context, addImage);
  if (context.operation === 'annotate') return updateDocument(context, annotate);
  return undefined;
}

type PageEdit = (document: PDFDocument, context: PdfEditorContext) => Promise<Record<string, unknown>>;

async function updateDocument(context: PdfEditorContext, edit: PageEdit): Promise<unknown> {
  const document = await PDFDocument.load(await readFile(context.path), { updateMetadata: false });
  const details = await edit(document, context);
  await writeAtomically(context.path, await document.save());
  return { ...details, operation: context.operation, path: context.path, updated: true, backend: 'desktop-pdf-editor' };
}

async function addText(document: PDFDocument, context: PdfEditorContext): Promise<Record<string, unknown>> {
  const pageIndex = requiredPage(context.params, document.getPageCount());
  const text = requiredString(context.params, 'text');
  const x = requiredNumber(context.params, 'x');
  const y = requiredNumber(context.params, 'y');
  const size = optionalNumber(context.params, 'size') ?? optionalNumber(context.params, 'fontSize') ?? 12;
  if (size <= 0 || size > 512) throw new Error('PDF text size must be greater than zero and no greater than 512.');
  const font = await document.embedFont(StandardFonts.Helvetica);
  document.getPage(pageIndex).drawText(text, { x, y, size, font });
  return { page: pageIndex, text };
}

async function addImage(document: PDFDocument, context: PdfEditorContext): Promise<Record<string, unknown>> {
  const pageIndex = requiredPage(context.params, document.getPageCount());
  const imagePath = requiredString(context.params, 'imagePath');
  const bytes = await readFile(imagePath);
  const image = isJpeg(bytes, imagePath) ? await document.embedJpg(bytes) : isPng(bytes, imagePath) ? await document.embedPng(bytes) : undefined;
  if (image === undefined) throw new Error('PDF images must be PNG or JPEG files.');
  const x = requiredNumber(context.params, 'x');
  const y = requiredNumber(context.params, 'y');
  const width = requiredPositiveNumber(context.params, 'width');
  const height = requiredPositiveNumber(context.params, 'height');
  document.getPage(pageIndex).drawImage(image, { x, y, width, height });
  return { page: pageIndex, imagePath, width, height };
}

async function annotate(document: PDFDocument, context: PdfEditorContext): Promise<Record<string, unknown>> {
  const pageIndex = requiredPage(context.params, document.getPageCount());
  const page = document.getPage(pageIndex);
  const text = requiredString(context.params, 'text');
  const x = requiredNumber(context.params, 'x');
  const y = requiredNumber(context.params, 'y');
  const width = optionalNumber(context.params, 'width') ?? 18;
  const height = optionalNumber(context.params, 'height') ?? 18;
  if (width <= 0 || height <= 0) throw new Error('PDF annotation dimensions must be greater than zero.');
  const annotations = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray) ?? PDFArray.withContext(document.context);
  const annotation = document.context.obj({
    Type: PDFName.of('Annot'),
    Subtype: PDFName.of('Text'),
    Rect: document.context.obj([x, y, x + width, y + height]),
    Contents: PDFString.of(text),
    Name: PDFName.of('Comment'),
    Open: false,
    C: document.context.obj([1, 1, 0]),
  });
  annotations.push(document.context.register(annotation));
  page.node.set(PDFName.of('Annots'), annotations);
  return { page: pageIndex, text };
}

async function redact(context: PdfEditorContext): Promise<unknown> {
  const render = context.commands.pdfRender;
  const info = context.commands.pdfInfo;
  if (render === undefined || info === undefined) throw new Error('PDF redaction requires pdftoppm and pdfinfo.');
  const areas = parseRedactionAreas(context.params['areas']);
  const pageInfo = await readPageInfo(context, info);
  const selected = new Map<number, RedactionArea[]>();
  for (const area of areas) {
    const dimensions = pageInfo[area.page];
    if (dimensions === undefined) throw new Error(`PDF redaction page ${String(area.page)} is outside the document.`);
    assertInsidePage(area, dimensions.width, dimensions.height);
    const pageAreas = selected.get(area.page) ?? [];
    pageAreas.push(area);
    selected.set(area.page, pageAreas);
  }
  const root = await mkdtemp(join(tmpdir(), 'lotagate-pdf-redaction-'));
  try {
    const output = await PDFDocument.create();
    for (const [pageIndex, dimensions] of pageInfo.entries()) {
      const prefix = join(root, `page-${String(pageIndex + 1)}`);
      await context.run(render, ['-png', '-singlefile', '-f', String(pageIndex + 1), '-l', String(pageIndex + 1), context.path, prefix], context.signal, 128 * 1024);
      const image = await output.embedPng(await readFile(`${prefix}.png`));
      const page = output.addPage([dimensions.width, dimensions.height]);
      page.drawImage(image, { x: 0, y: 0, width: dimensions.width, height: dimensions.height });
      for (const area of selected.get(pageIndex) ?? []) page.drawRectangle({ x: area.x, y: area.y, width: area.width, height: area.height, color: rgb(0, 0, 0) });
    }
    await writeAtomically(context.path, await output.save());
  } finally {
    await rm(root, { recursive: true, force: true });
  }
  return { operation: 'redact', path: context.path, redactedAreas: areas.length, updated: true, backend: 'desktop-pdf-editor' };
}

interface PageDimensions { readonly width: number; readonly height: number; }
interface RedactionArea extends PageDimensions { readonly page: number; readonly x: number; readonly y: number; }

async function readPageInfo(context: PdfEditorContext, command: string): Promise<PageDimensions[]> {
  const result = await context.run(command, [context.path], context.signal, 512 * 1024);
  const text = result.stdout.toString('utf8');
  const pages = Number(/^Pages:\s+(\d+)/mu.exec(text)?.[1] ?? 0);
  const width = Number(/^Page size:\s+([\d.]+)\s+x\s+([\d.]+)/mu.exec(text)?.[1] ?? 0);
  const height = Number(/^Page size:\s+[\d.]+\s+x\s+([\d.]+)/mu.exec(text)?.[1] ?? 0);
  if (!Number.isInteger(pages) || pages <= 0 || width <= 0 || height <= 0) throw new Error('Unable to determine PDF page dimensions for redaction.');
  return Array.from({ length: pages }, () => ({ width, height }));
}

function parseRedactionAreas(value: unknown): RedactionArea[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error('PDF redaction requires at least one area.');
  return value.map((item, index) => {
    if (!isRecord(item)) throw new Error(`PDF redaction area ${String(index)} is invalid.`);
    const page = requiredInteger(item, 'page');
    const x = requiredNumber(item, 'x');
    const y = requiredNumber(item, 'y');
    const width = requiredPositiveNumber(item, 'width');
    const height = requiredPositiveNumber(item, 'height');
    return { page, x, y, width, height };
  });
}

function assertInsidePage(area: RedactionArea, pageWidth: number, pageHeight: number): void {
  if (area.x < 0 || area.y < 0 || area.x + area.width > pageWidth || area.y + area.height > pageHeight) throw new Error(`PDF redaction area on page ${String(area.page)} exceeds the page bounds.`);
}

async function writeAtomically(path: string, bytes: Uint8Array): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const root = await mkdtemp(join(dirname(path), '.lotagate-pdf-write-'));
  const temporary = join(root, `${extname(path).slice(1) || 'pdf'}.tmp`);
  try { await writeFile(temporary, bytes, { flag: 'wx' }); await rename(temporary, path); }
  finally { await rm(root, { recursive: true, force: true }); }
}

function requiredPage(params: Record<string, unknown>, count: number): number { const page = requiredInteger(params, 'page'); if (page < 0 || page >= count) throw new Error('The PDF page index is outside the document.'); return page; }
function requiredString(params: Record<string, unknown>, key: string): string { const value = params[key]; if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`The PDF operation requires ${key}.`); return value; }
function requiredNumber(params: Record<string, unknown>, key: string): number { const value = params[key]; if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`The PDF operation requires a finite ${key}.`); return value; }
function requiredPositiveNumber(params: Record<string, unknown>, key: string): number { const value = requiredNumber(params, key); if (value <= 0) throw new Error(`The PDF operation requires a positive ${key}.`); return value; }
function requiredInteger(params: Record<string, unknown>, key: string): number { const value = params[key]; if (typeof value !== 'number' || !Number.isInteger(value)) throw new Error(`The PDF operation requires an integer ${key}.`); return value; }
function optionalNumber(params: Record<string, unknown>, key: string): number | undefined { const value = params[key]; return typeof value === 'number' && Number.isFinite(value) ? value : undefined; }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function isPng(bytes: Uint8Array, _path: string): boolean { return bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47; }
function isJpeg(bytes: Uint8Array, _path: string): boolean { return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff; }
