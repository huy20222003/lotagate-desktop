import { copyFile, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import type { BoundedCommandResult } from '../process/bounded-command.js';
import type { PortableDocumentCommands } from './portable-document-command-resolver.js';
import { requestedPdfPageSet, requestedPdfPages } from './pdf-page-selection.js';

export interface PortablePdfOperationContext {
  readonly path: string;
  readonly operation: string;
  readonly params: Record<string, unknown>;
  readonly commands: PortableDocumentCommands;
  readonly signal?: AbortSignal;
  readonly run: (command: string, args: readonly string[], signal?: AbortSignal, maxOutputBytes?: number) => Promise<BoundedCommandResult>;
}

/** Executes PDF operations that are provided by the optional Poppler/PDF toolchain. */
export async function executePortablePdfOperation(context: PortablePdfOperationContext): Promise<unknown | undefined> {
  const { operation } = context;
  if (operation === 'recognizeText') return recognizeText(context);
  if (operation === 'extractImages') return extractImages(context);
  if (operation === 'extractLinks') return extractLinks(context);
  if (operation === 'extractAnnotations') return extractAnnotations(context);
  if (operation === 'manageBookmarks') return manageBookmarks(context);
  if (operation === 'manageAttachments') return manageAttachments(context);
  if (operation === 'flattenForms') return transformPdf(context, 'flatten');
  if (operation === 'optimize') return transformPdf(context, 'optimize');
  if (operation === 'addPageNumbers') return addPageNumbers(context);
  if (operation === 'insertPages' || operation === 'deletePages' || operation === 'reorderPages' || operation === 'rotatePages' || operation === 'split') return transformPages(context);
  if (operation === 'readForm') return readForm(context);
  if (operation === 'fillForm') return fillForm(context);
  return undefined;
}

async function recognizeText(context: PortablePdfOperationContext): Promise<unknown> {
  const render = context.commands.pdfRender;
  const ocr = context.commands.pdfOcr;
  if (render === undefined || ocr === undefined) throw new Error('PDF OCR requires pdftoppm and tesseract.');
  const pages = await selectedPages(context);
  const root = await mkdtemp(join(tmpdir(), 'lotagate-pdf-ocr-'));
  const chunks: string[] = [];
  try {
    for (const page of pages) {
      const prefix = join(root, `page-${page + 1}`);
      await context.run(render, ['-png', '-singlefile', '-f', String(page + 1), '-l', String(page + 1), context.path, prefix], context.signal, 128 * 1024);
      const image = `${prefix}.png`;
      const language = typeof context.params['language'] === 'string' && context.params['language'].trim().length > 0 ? context.params['language'].trim() : undefined;
      const args = language === undefined ? [image, 'stdout'] : [image, 'stdout', '-l', language];
      const result = await context.run(ocr, args, context.signal, 4 * 1024 * 1024);
      chunks.push(result.stdout.toString('utf8').trim());
    }
  } finally { await rm(root, { recursive: true, force: true }); }
  return { format: 'pdf', text: chunks.join('\n\n').trim(), pages, backend: 'portable-pdf-ocr' };
}

async function extractImages(context: PortablePdfOperationContext): Promise<unknown> {
  const command = context.commands.pdfImages;
  if (command === undefined) throw new Error('PDF image extraction requires pdfimages.');
  const outputPath = requiredOutputDirectory(context.params);
  await mkdir(outputPath, { recursive: true });
  const selected = requestedPdfPages(context.params, 100);
  const prefixes = selected === undefined
    ? [join(outputPath, 'image')]
    : selected.map(page => join(outputPath, `image-page-${String(page + 1).padStart(4, '0')}`));
  if (selected === undefined) {
    await context.run(command, ['-png', context.path, prefixes[0]!], context.signal, 128 * 1024);
  } else {
    for (const [index, page] of selected.entries()) {
      await context.run(command, ['-png', '-f', String(page + 1), '-l', String(page + 1), context.path, prefixes[index]!], context.signal, 128 * 1024);
    }
  }
  const files = (await readdir(outputPath)).filter(name => prefixes.some(prefix => name.startsWith(basename(prefix)))).map(name => join(outputPath, name)).sort();
  return { format: 'pdf', outputPath, files, backend: 'portable-pdf-images' };
}

async function extractLinks(context: PortablePdfOperationContext): Promise<unknown> {
  const command = context.commands.pdfLinks;
  if (command === undefined) throw new Error('PDF link extraction requires pdftohtml.');
  const result = await context.run(command, ['-xml', '-stdout', '-hidden', context.path, '-'], context.signal, 8 * 1024 * 1024);
  const xml = result.stdout.toString('utf8');
  const selected = requestedPdfPageSet(context.params);
  let page = -1;
  const links: Array<Record<string, unknown>> = [];
  for (const token of xml.matchAll(/<page\b[^>]*\bnumber="(\d+)"[^>]*>|<link\b([^>]*)>([^<]*)<\/link>/giu)) {
    if (token[1] !== undefined) { page = Number(token[1]) - 1; continue; }
    const attributes = token[2] ?? '';
    if (selected !== undefined && !selected.has(page)) continue;
    const address = /href="([^"]*)"/iu.exec(attributes)?.[1];
    if (address === undefined) continue;
    links.push({ page, address, text: (token[3] ?? '').trim() });
  }
  return { operation: 'extractLinks', links, backend: 'portable-pdf-links' };
}

async function extractAnnotations(context: PortablePdfOperationContext): Promise<unknown> {
  const command = context.commands.pdfToolkit;
  if (command === undefined) throw new Error('PDF annotation extraction requires pdftk.');
  const result = await context.run(command, [context.path, 'dump_data_annots'], context.signal, 4 * 1024 * 1024);
  const annotations = parseKeyValueBlocks(result.stdout.toString('utf8'), 'Annotation');
  const selected = requestedPdfPageSet(context.params);
  const filtered = selected === undefined ? annotations : annotations.filter(item => {
    const page = Number(item['Page'] ?? item['PageNumber']);
    return !Number.isFinite(page) || selected.has(page - 1);
  });
  return { operation: 'extractAnnotations', annotations: filtered, backend: 'portable-pdf-annotations' };
}

async function manageBookmarks(context: PortablePdfOperationContext): Promise<unknown> {
  const toolkit = context.commands.pdfToolkit;
  if (toolkit === undefined) throw new Error('PDF bookmark management requires pdftk.');
  const operation = requiredString(context.params, 'operation');
  const bookmarks = await readBookmarks(context, toolkit);
  if (operation === 'list') return { operation, bookmarks, backend: 'portable-pdf-bookmarks' };
  const bookmark = context.params['bookmark'];
  if (!isRecord(bookmark)) throw new Error('PDF bookmark details are required for this operation.');
  const next = bookmarks.map(item => ({ ...item }));
  if (operation === 'add') {
    const title = typeof bookmark['title'] === 'string' ? bookmark['title'] : undefined;
    const page = typeof bookmark['page'] === 'number' && Number.isInteger(bookmark['page']) ? bookmark['page'] : undefined;
    if (title === undefined || page === undefined || page < 0) throw new Error('A bookmark title and non-negative page are required.');
    next.push({ title, level: integerValue(bookmark['level'], 1), page });
  } else {
    const index = integerValue(bookmark['index'], -1);
    if (index < 0 || index >= next.length) throw new Error('The bookmark index is invalid.');
    if (operation === 'delete') next.splice(index, 1);
    else if (operation === 'update') {
      const current = next[index]!;
      if (typeof bookmark['title'] === 'string') current.title = bookmark['title'];
      if (typeof bookmark['page'] === 'number' && Number.isInteger(bookmark['page']) && bookmark['page'] >= 0) current.page = bookmark['page'];
      if (typeof bookmark['level'] === 'number' && Number.isInteger(bookmark['level'])) current.level = bookmark['level'];
    } else throw new Error(`Unsupported PDF bookmark operation '${operation}'.`);
  }
  const infoRoot = await mkdtemp(join(tmpdir(), 'lotagate-pdf-bookmarks-'));
  const temporary = await temporaryPdfPath('bookmarks');
  try {
    const infoPath = join(infoRoot, 'bookmarks.txt');
    await writeFile(infoPath, bookmarkInfo(next), 'utf8');
    await context.run(toolkit, [context.path, 'update_info_utf8', infoPath, 'output', temporary], context.signal, 128 * 1024);
    await copyFile(temporary, context.path);
    return { operation, bookmarks: next, updated: true, backend: 'portable-pdf-bookmarks' };
  } finally {
    await rm(infoRoot, { recursive: true, force: true });
    await rm(dirname(temporary), { recursive: true, force: true });
  }
}

async function readBookmarks(context: PortablePdfOperationContext, toolkit: string): Promise<Array<{ title: string; level: number; page: number }>> {
  const result = await context.run(toolkit, [context.path, 'dump_data_utf8'], context.signal, 2 * 1024 * 1024);
  const bookmarks: Array<{ title: string; level: number; page: number }> = [];
  let current: { title?: string; level?: number; page?: number } | undefined;
  for (const line of result.stdout.toString('utf8').split(/\r?\n/u)) {
    if (line === 'BookmarkBegin') { if (current?.title !== undefined && current.page !== undefined) bookmarks.push({ title: current.title, level: current.level ?? 1, page: current.page }); current = {}; continue; }
    if (current === undefined) continue;
    const title = /^BookmarkTitle:\s*(.*)$/u.exec(line)?.[1];
    const level = /^BookmarkLevel:\s*(\d+)$/u.exec(line)?.[1];
    const page = /^BookmarkPageNumber:\s*(\d+)$/u.exec(line)?.[1];
    if (title !== undefined) current.title = title;
    if (level !== undefined) current.level = Number(level);
    if (page !== undefined) current.page = Number(page) - 1;
  }
  if (current?.title !== undefined && current.page !== undefined) bookmarks.push({ title: current.title, level: current.level ?? 1, page: current.page });
  return bookmarks;
}

function bookmarkInfo(bookmarks: readonly { title: string; level: number; page: number }[]): string {
  const lines = ['InfoBegin', 'InfoKey: ModDate', `InfoValue: D:${new Date().toISOString().replace(/[-:TZ.]/gu, '').slice(0, 14)}`];
  for (const bookmark of bookmarks) lines.push('BookmarkBegin', `BookmarkTitle: ${bookmark.title}`, `BookmarkLevel: ${Math.max(1, bookmark.level)}`, `BookmarkPageNumber: ${bookmark.page + 1}`);
  return `${lines.join('\n')}\n`;
}

async function manageAttachments(context: PortablePdfOperationContext): Promise<unknown> {
  const detach = context.commands.pdfAttachments;
  const mode = requiredString(context.params, 'operation');
  if (mode === 'list') {
    if (detach === undefined) throw new Error('PDF attachment listing requires pdfdetach.');
    const result = await context.run(detach, ['-list', context.path], context.signal, 512 * 1024);
    return { operation: mode, details: result.stdout.toString('utf8'), backend: 'portable-pdf-attachments' };
  }
  if (mode === 'extract') {
    if (detach === undefined) throw new Error('PDF attachment extraction requires pdfdetach.');
    const outputPath = requiredOutputDirectory(context.params);
    await mkdir(outputPath, { recursive: true });
    await context.run(detach, ['-saveall', '-o', outputPath, context.path], context.signal, 512 * 1024);
    const files = (await readdir(outputPath)).map(name => join(outputPath, name)).sort();
    return { operation: mode, outputPath, files, backend: 'portable-pdf-attachments' };
  }
  const toolkit = context.commands.pdfToolkit;
  const qpdf = context.commands.pdfQpdf;
  if (mode === 'delete') {
    if (qpdf === undefined) throw new Error('PDF attachment deletion requires qpdf.');
    const name = requiredString(context.params, 'name');
    const temporary = await temporaryPdfPath('attachment-delete');
    try {
      await context.run(qpdf, [context.path, `--remove-attachment=${name}`, temporary], context.signal, 128 * 1024);
      await copyFile(temporary, context.path);
      return { operation: mode, name, updated: true, backend: 'portable-pdf-attachments' };
    } finally { await rm(dirname(temporary), { recursive: true, force: true }); }
  }
  if (toolkit === undefined) throw new Error('PDF attachment updates require pdftk.');
  if (mode !== 'attach') throw new Error(`Portable PDF attachment operation '${mode}' is not supported.`);
  const sourcePath = requiredString(context.params, 'sourcePath');
  const temporary = await temporaryPdfPath('attachment');
  try {
    await context.run(toolkit, [context.path, 'attach_files', sourcePath, 'output', temporary], context.signal, 128 * 1024);
    await copyFile(temporary, context.path);
    return { operation: mode, updated: true, backend: 'portable-pdf-attachments' };
  } finally { await rm(dirname(temporary), { recursive: true, force: true }); }
}

async function addPageNumbers(context: PortablePdfOperationContext): Promise<unknown> {
  const toolkit = context.commands.pdfToolkit;
  if (toolkit === undefined) throw new Error('PDF page numbering requires pdftk.');
  const outputPath = requiredOutputPath(context.params);
  const count = await pageCount(context);
  const stamp = await temporaryPdfPath('page-numbers-stamp');
  const temporary = await temporaryPdfPath('page-numbers-output');
  try {
    const options = isRecord(context.params['options']) ? context.params['options'] : {};
    await writeFile(stamp, createPageNumberStamp(count, options), 'utf8');
    await context.run(toolkit, [context.path, 'multistamp', stamp, 'output', temporary], context.signal, 128 * 1024);
    await mkdir(dirname(outputPath), { recursive: true });
    await copyFile(temporary, outputPath);
    return { operation: 'addPageNumbers', path: outputPath, pages: count, updated: true, backend: 'portable-pdf-page-numbers' };
  } finally {
    await rm(dirname(stamp), { recursive: true, force: true });
    await rm(dirname(temporary), { recursive: true, force: true });
  }
}

function createPageNumberStamp(count: number, options: Record<string, unknown>): string {
  const position = options['position'] === 'top' ? 'top' : options['position'] === 'left' ? 'left' : options['position'] === 'right' ? 'right' : 'bottom';
  const objects: string[] = ['<< /Type /Catalog /Pages 2 0 R >>', ''];
  const pageReferences: string[] = [];
  for (let page = 1; page <= count; page++) { const pageObject = objects.length + 1; const contentObject = pageObject + 1; pageReferences.push(`${pageObject} 0 R`); objects.push('', ''); void contentObject; }
  objects[1] = `<< /Type /Pages /Kids [${pageReferences.join(' ')}] /Count ${count} >>`;
  let pageIndex = 0;
  for (let index = 2; index < objects.length; index += 2) {
    const page = pageIndex + 1;
    const pageObject = index + 1;
    const contentObject = pageObject + 1;
    const x = position === 'left' ? 48 : position === 'right' ? 540 : 306;
    const y = position === 'top' ? 756 : 32;
    const content = `BT /F1 10 Tf ${x} ${y} Td (${page}) Tj ET`;
    objects[index] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${contentObject} 0 R /Resources << /Font << /F1 ${objects.length + 1} 0 R >> >> >>`;
    objects[index + 1] = `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;
    pageIndex++;
  }
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  return buildPdf(objects);
}

function buildPdf(objects: readonly string[]): string {
  let document = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (const [index, object] of objects.entries()) { offsets.push(document.length); document += `${index + 1} 0 obj\n${object}\nendobj\n`; }
  const xref = document.length;
  document += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) document += `${String(offset).padStart(10, '0')} 00000 n \n`;
  document += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return document;
}

async function transformPdf(context: PortablePdfOperationContext, mode: 'flatten' | 'optimize'): Promise<unknown> {
  const outputPath = requiredOutputPath(context.params);
  const temporary = await temporaryPdfPath(mode);
  try {
    if (mode === 'flatten') {
      const toolkit = context.commands.pdfToolkit;
      if (toolkit === undefined) throw new Error('PDF form flattening requires pdftk.');
      await context.run(toolkit, [context.path, 'output', temporary, 'flatten'], context.signal, 128 * 1024);
    } else {
      const optimizer = context.commands.pdfOptimizer;
      if (optimizer === undefined) throw new Error('PDF optimization requires Ghostscript.');
      await context.run(optimizer, ['-sDEVICE=pdfwrite', '-dBATCH', '-dNOPAUSE', '-dSAFER', `-sOutputFile=${temporary}`, context.path], context.signal, 128 * 1024);
    }
    await mkdir(dirname(outputPath), { recursive: true });
    await copyFile(temporary, outputPath);
    return { operation: mode, path: outputPath, updated: true, backend: 'portable-pdf-transform' };
  } finally { await rm(dirname(temporary), { recursive: true, force: true }); }
}

async function transformPages(context: PortablePdfOperationContext): Promise<unknown> {
  const toolkit = context.commands.pdfToolkit;
  if (toolkit === undefined) throw new Error('PDF page editing requires pdftk.');
  const outputPath = context.operation === 'split' ? requiredOutputPath(context.params) : context.path;
  const temporary = await temporaryPdfPath('pages');
  try {
    const count = await pageCount(context);
    const pageSpecs = pageSpecifications(context.operation, context.params, count);
    if (context.operation === 'insertPages') {
      const sourcePath = requiredString(context.params, 'sourcePath');
      const before = integerParam(context.params, 'beforePage', 0);
      if (before < 0 || before > count) throw new Error('The PDF insertion page is outside the document.');
      const args = [
        `A=${context.path}`, `B=${sourcePath}`, 'cat',
        ...(before === 0 ? [] : [`A1-${before}`]), 'B1-end', ...(before === 0 ? [`A1-end`] : [`A${before + 1}-end`]), 'output', temporary,
      ];
      await context.run(toolkit, args, context.signal, 128 * 1024);
    } else {
      await context.run(toolkit, [context.path, 'cat', ...pageSpecs, 'output', temporary], context.signal, 128 * 1024);
    }
    await mkdir(dirname(outputPath), { recursive: true });
    await copyFile(temporary, outputPath);
    return { operation: context.operation, path: outputPath, pages: pageSpecs, updated: true, backend: 'portable-pdf-pages' };
  } finally { await rm(dirname(temporary), { recursive: true, force: true }); }
}

async function readForm(context: PortablePdfOperationContext): Promise<unknown> {
  const toolkit = context.commands.pdfToolkit;
  if (toolkit === undefined) throw new Error('PDF form inspection requires pdftk.');
  const result = await context.run(toolkit, [context.path, 'dump_data_fields'], context.signal, 2 * 1024 * 1024);
  return { operation: 'readForm', fields: parseKeyValueBlocks(result.stdout.toString('utf8'), 'Field'), backend: 'portable-pdf-forms' };
}

async function fillForm(context: PortablePdfOperationContext): Promise<unknown> {
  const toolkit = context.commands.pdfToolkit;
  if (toolkit === undefined) throw new Error('PDF form filling requires pdftk.');
  const values = context.params['values'];
  if (!isRecord(values)) throw new Error('PDF form values must be an object.');
  const outputPath = requiredOutputPath(context.params);
  const temporaryData = join(await mkdtemp(join(tmpdir(), 'lotagate-pdf-form-')), 'data.txt');
  const temporaryPdf = await temporaryPdfPath('form');
  try {
    const lines = Object.entries(values).map(([key, value]) => `${key}: ${String(value)}`);
    await writeFile(temporaryData, `${lines.join('\n')}\n`, 'utf8');
    await context.run(toolkit, [context.path, 'fill_form', temporaryData, 'output', temporaryPdf], context.signal, 128 * 1024);
    await mkdir(dirname(outputPath), { recursive: true });
    await copyFile(temporaryPdf, outputPath);
    return { operation: 'fillForm', path: outputPath, updated: true, backend: 'portable-pdf-forms' };
  } finally { await rm(dirname(temporaryData), { recursive: true, force: true }); await rm(dirname(temporaryPdf), { recursive: true, force: true }); }
}

async function selectedPages(context: PortablePdfOperationContext): Promise<number[]> {
  const selected = requestedPdfPages(context.params);
  if (selected !== undefined) return selected;
  const count = await pageCount(context);
  return Array.from({ length: Math.min(count, 100) }, (_value, index) => index);
}

async function pageCount(context: PortablePdfOperationContext): Promise<number> {
  const info = context.commands.pdfInfo;
  if (info === undefined) throw new Error('PDF page operations require pdfinfo.');
  const result = await context.run(info, [context.path], context.signal, 512 * 1024);
  const pages = /^Pages:\s+(\d+)/mu.exec(result.stdout.toString('utf8'))?.[1];
  if (pages === undefined) throw new Error('Unable to determine the PDF page count.');
  return Number(pages);
}

function pageSpecifications(operation: string, params: Record<string, unknown>, count: number): string[] {
  if (operation === 'split') return pageList(params, count);
  if (operation === 'deletePages') {
    const deleted = new Set(pageList(params, count).map(value => Number(value) - 1));
    const kept = Array.from({ length: count }, (_value, index) => index + 1).filter(page => !deleted.has(page - 1));
    if (kept.length === 0) throw new Error('Deleting the selected pages would produce an empty PDF.');
    return kept.map(String);
  }
  if (operation === 'reorderPages') {
    const order = params['order'];
    if (!Array.isArray(order) || order.length !== count || order.some(value => typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value >= count)) throw new Error('PDF page order must be a complete page permutation.');
    const values = order.map(value => Number(value) + 1);
    if (new Set(values).size !== count) throw new Error('PDF page order must not contain duplicates.');
    return values.map(String);
  }
  if (operation === 'rotatePages') {
    const selected = new Set(pageList(params, count).map(value => Number(value)));
    const rotation = integerParam(params, 'degrees', 90);
    const direction = rotation === 90 ? 'east' : rotation === 180 ? 'south' : rotation === 270 ? 'west' : undefined;
    if (direction === undefined) throw new Error('PDF rotation must be 90, 180, or 270 degrees.');
    return Array.from({ length: count }, (_value, index) => { const page = index + 1; return `${page}${selected.has(page) ? direction : 'north'}`; });
  }
  return Array.from({ length: count }, (_value, index) => String(index + 1));
}

function pageList(params: Record<string, unknown>, count: number): string[] {
  const pages = requestedPdfPages(params);
  if (pages === undefined) return Array.from({ length: count }, (_value, index) => String(index + 1));
  if (pages.some(page => page >= count)) throw new Error('The PDF page selection contains a page outside the document.');
  return pages.map(page => String(page + 1));
}

function parseKeyValueBlocks(text: string, prefix: string): Array<Record<string, string>> {
  const items: Array<Record<string, string>> = [];
  let current: Record<string, string> = {};
  for (const line of text.split(/\r?\n/u)) {
    if (line === '---') { if (Object.keys(current).length > 0) items.push(current); current = {}; continue; }
    const match = new RegExp(`^${prefix}([A-Za-z]+):\\s*(.*)$`, 'u').exec(line);
    if (match?.[1] !== undefined && match[2] !== undefined) current[match[1]] = match[2];
  }
  if (Object.keys(current).length > 0) items.push(current);
  return items;
}

async function temporaryPdfPath(label: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), `lotagate-pdf-${label}-`));
  return join(root, 'output.pdf');
}
function requiredOutputPath(params: Record<string, unknown>): string { const value = params['outputPath']; if (typeof value !== 'string' || value.trim().length === 0) throw new Error('The PDF operation requires an outputPath.'); return value; }
function requiredOutputDirectory(params: Record<string, unknown>): string { return requiredOutputPath(params); }
function requiredString(params: Record<string, unknown>, key: string): string { const value = params[key]; if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`The PDF operation requires ${key}.`); return value; }
function integerParam(params: Record<string, unknown>, key: string, fallback: number): number { const value = params[key]; return typeof value === 'number' && Number.isInteger(value) ? value : fallback; }
function integerValue(value: unknown, fallback: number): number { return typeof value === 'number' && Number.isInteger(value) ? value : fallback; }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
