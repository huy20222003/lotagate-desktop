import { access, copyFile, mkdir, mkdtemp, open, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join } from 'node:path';
import type { DesktopDocumentFormat, DesktopHostCapability } from '../../contracts/agent-protocol/v1/host-capabilities.js';
import { runBoundedCommand, type BoundedCommandResult } from '../process/bounded-command.js';
import { DOCUMENT_BACKEND_MAX_OUTPUT_BYTES, DOCUMENT_BACKEND_TIMEOUT_MS, DOCUMENT_FORMATS, type DocumentFormat } from './document-constants.js';
import type { DocumentBackend, DocumentBackendInput } from './document-backend.js';
import { buildPortableDocumentCapabilities } from './portable-document-capabilities.js';
import { resolvePortableDocumentCommands, type PortableDocumentCommands } from './portable-document-command-resolver.js';
import { executePortablePdfOperation } from './portable-pdf-operations.js';
import { executePdfEditorOperation } from './pdf-editor.js';
import { requestedPdfPages } from './pdf-page-selection.js';
import { commandWorks, firstAvailableCommand } from '../process/command-availability.js';

export async function createPortableDocumentBackend(officeBridgeScript?: string): Promise<PortableDocumentBackend> {
  let commands = await resolvePortableDocumentCommands();
  if (officeBridgeScript !== undefined && commands.office !== undefined && await fileExists(officeBridgeScript)) {
    const python = await firstAvailableCommand(['python3', 'python']);
    if (python !== undefined && await commandWorks(python, ['-c', 'import uno'])) commands = { ...commands, officeBridge: { command: python, scriptPath: officeBridgeScript } };
  }
  return new PortableDocumentBackend(commands);
}

export class PortableDocumentBackend implements DocumentBackend {
  readonly id = process.platform === 'darwin' ? 'macos-portable-documents' : 'linux-portable-documents';
  readonly capabilities: Partial<Record<DesktopDocumentFormat, DesktopHostCapability>>;

  constructor(private readonly commands: PortableDocumentCommands, private readonly timeoutMs = DOCUMENT_BACKEND_TIMEOUT_MS) {
    this.capabilities = buildPortableDocumentCapabilities(this.id, commands);
  }

  async execute(cwd: string, input: DocumentBackendInput, signal?: AbortSignal): Promise<unknown> {
    const [format, action] = input.action.split('.', 2);
    if (!isDocumentFormat(format) || action === undefined) throw new Error('The portable document backend received an invalid action.');
    if (action === 'create') return this.create(format, input.path, input.params, cwd, signal);
    if (action === 'validate') return this.validate(format, input.path);
    if (action === 'inspect') return this.inspect(format, input.path, signal);
    if (action === 'save') return { saved: true, path: input.path, backend: this.id };
    if (this.commands.officeBridge === undefined && format === 'docs' && isTextDocument(input.path)) return this.executeTextDocument(action, input.path, input.params);
    if (this.commands.officeBridge === undefined && format === 'excel' && isCsvDocument(input.path)) return this.executeCsvDocument(action, input.path, input.params);
    if (format !== 'pdf' && action !== 'render' && this.commands.officeBridge !== undefined) {
      const bridged = await this.executeOfficeBridge(cwd, format, action, input.path, input.params, signal);
      if (bridged !== undefined) return bridged;
    }
    if (format === 'pdf' && action === 'readText') return this.readPdfText(input.path, input.params, signal);
    if (format === 'pdf' && action === 'extractTables') return this.readPdfText(input.path, input.params, signal);
    if (format === 'pdf' && action === 'search') return this.searchPdf(input.path, input.params, signal);
    if (format === 'pdf' && action === 'render') return this.renderPdf(input.path, input.params, signal);
    if (format === 'pdf' && action === 'merge') return this.mergePdf(input.params, signal);
    if (format === 'pdf') {
      const edited = await executePdfEditorOperation({ path: input.path, operation: action, params: input.params, commands: this.commands, ...(signal === undefined ? {} : { signal }), run: (command, args, childSignal, maxOutputBytes = DOCUMENT_BACKEND_MAX_OUTPUT_BYTES) => this.run(command, args, childSignal, maxOutputBytes) });
      if (edited !== undefined) return edited;
      const result = await executePortablePdfOperation({ path: input.path, operation: action, params: input.params, commands: this.commands, ...(signal === undefined ? {} : { signal }), run: (command, args, childSignal, maxOutputBytes = DOCUMENT_BACKEND_MAX_OUTPUT_BYTES) => this.run(command, args, childSignal, maxOutputBytes) });
      if (result !== undefined) return result;
    }
    if (action === 'extractText' || action === 'readContent') return this.extractOfficeText(format, input.path, cwd, signal);
    if (action === 'exportPdf') return this.exportOfficePdf(input.path, input.params, cwd, signal);
    if (action === 'exportCsv') return this.exportOfficeCsv(input.path, input.params, cwd, signal);
    if (action === 'render') return this.renderOffice(input.path, input.params, cwd, signal);
    throw new Error(`The portable document backend does not support ${input.action}.`);
  }

  private async validate(format: DocumentFormat, path: string): Promise<unknown> {
    const extension = extname(path).toLowerCase();
    const signature = await readFilePrefix(path, 8);
    const valid = format === 'pdf'
      ? signature.subarray(0, 5).toString('ascii') === '%PDF-'
      : isPlainTextDocument(format, extension)
        ? true
        : isRtfDocument(format, extension)
          ? signature.toString('ascii').startsWith('{\\rtf')
          : isLegacyOfficeDocument(format, extension)
            ? signature.equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))
            : signature.subarray(0, 2).toString('ascii') === 'PK';
    return { valid, format, backend: this.id, path: basename(path) };
  }

  private async create(format: DocumentFormat, path: string, params: Record<string, unknown>, cwd: string, signal?: AbortSignal): Promise<unknown> {
    if (format !== 'pdf' && this.commands.officeBridge !== undefined) {
      const bridged = await this.executeOfficeBridge(cwd, format, 'create', path, params, signal);
      if (bridged !== undefined) return bridged;
    }
    if (format === 'docs' && isTextDocument(path)) {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, typeof params['title'] === 'string' ? `${params['title']}\n` : '', { flag: 'wx' });
      return { created: true, format, path, backend: this.id, cwd };
    }
    if (format === 'excel' && isCsvDocument(path)) {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, '', { flag: 'wx' });
      return { created: true, format, path, backend: this.id, cwd };
    }
    if (format !== 'pdf') throw new Error(`Creating ${format} documents requires LibreOffice with the UNO bridge on a portable host.`);
    const title = typeof params['title'] === 'string' ? params['title'] : '';
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, createMinimalPdf(title), { flag: 'wx' });
    return { created: true, format, path, backend: this.id, cwd };
  }

  private async inspect(format: DocumentFormat, path: string, signal?: AbortSignal): Promise<unknown> {
    const details = await stat(path);
    const result: Record<string, unknown> = { format, backend: this.id, path: basename(path), sizeBytes: details.size, modifiedAt: details.mtime.toISOString() };
    if (format === 'pdf' && this.commands.pdfInfo !== undefined) {
      const info = await this.run(this.commands.pdfInfo, [path], signal, 512 * 1024);
      const pages = /^Pages:\s+(\d+)/mu.exec(info.stdout.toString('utf8'))?.[1];
      if (pages !== undefined) result['pages'] = Number(pages);
    }
    return result;
  }

  private async readPdfText(path: string, params: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
    if (this.commands.pdfText === undefined) throw new Error('PDF text extraction requires pdftotext.');
    const pages = await this.readPdfPages(path, params, signal);
    return {
      text: pages.map(page => page.text).join('\f'),
      ...(pages.length === 0 ? {} : { pages: pages.map(page => page.page) }),
      backend: this.id,
    };
  }

  private async searchPdf(path: string, params: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
    const query = typeof params['query'] === 'string' ? params['query'] : '';
    const maxResults = typeof params['maxResults'] === 'number' && Number.isFinite(params['maxResults']) ? Math.max(1, Math.min(1_000, Math.floor(params['maxResults']))) : 100;
    const pages = await this.readPdfPages(path, params, signal);
    const matches: Array<{ page: number; line: number; text: string }> = [];
    for (const page of pages) {
      for (const [line, text] of page.text.split(/\r?\n/u).entries()) {
        if (!text.toLocaleLowerCase().includes(query.toLocaleLowerCase())) continue;
        matches.push({ page: page.page, line, text: text.trim() });
        if (matches.length >= maxResults) return { query, matches, truncated: true, backend: this.id };
      }
    }
    return { query, matches, truncated: false, backend: this.id };
  }

  private async renderPdf(path: string, params: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
    if (this.commands.pdfRender === undefined) throw new Error('PDF rendering requires pdftoppm.');
    const outputPath = outputPathOf(params);
    if (outputPath === undefined) throw new Error('PDF rendering requires an outputPath.');
    const directory = await ensureDirectory(outputPath);
    const prefix = join(directory, basename(outputPath, extname(outputPath)));
    const selected = requestedPdfPages(params, 100);
    const files: string[] = [];
    if (selected === undefined) {
      await this.run(this.commands.pdfRender, ['-png', path, prefix], signal, 128 * 1024);
      files.push(...(await readdir(directory)).filter(name => name.startsWith(basename(prefix)) && name.endsWith('.png')).map(name => join(directory, name)).sort());
    } else {
      for (const page of selected) {
        const pagePrefix = selected.length === 1 && extname(outputPath).toLowerCase() === '.png'
          ? prefix
          : join(directory, `${basename(prefix)}-page-${String(page + 1).padStart(4, '0')}`);
        await this.run(this.commands.pdfRender, ['-png', '-singlefile', '-f', String(page + 1), '-l', String(page + 1), path, pagePrefix], signal, 128 * 1024);
        files.push(`${pagePrefix}.png`);
      }
    }
    return { files, backend: this.id };
  }

  private async readPdfPages(path: string, params: Record<string, unknown>, signal?: AbortSignal): Promise<Array<{ page: number; text: string }>> {
    if (this.commands.pdfText === undefined) throw new Error('PDF text extraction requires pdftotext.');
    const selected = requestedPdfPages(params, 100);
    if (selected !== undefined) {
      const pages: Array<{ page: number; text: string }> = [];
      for (const page of selected) {
        const result = await this.run(this.commands.pdfText, ['-layout', '-f', String(page + 1), '-l', String(page + 1), path, '-'], signal, DOCUMENT_BACKEND_MAX_OUTPUT_BYTES);
        pages.push({ page, text: result.stdout.toString('utf8') });
      }
      return pages;
    }
    const result = await this.run(this.commands.pdfText, ['-layout', path, '-'], signal, DOCUMENT_BACKEND_MAX_OUTPUT_BYTES);
    return result.stdout.toString('utf8').split('\f').map((text, page) => ({ page, text }));
  }

  private async mergePdf(params: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
    if (this.commands.pdfMerge === undefined) throw new Error('PDF merging requires pdfunite.');
    const paths = params['paths'];
    const outputPath = outputPathOf(params);
    if (!Array.isArray(paths) || paths.some(path => typeof path !== 'string') || outputPath === undefined) throw new Error('PDF merge requires input paths and an outputPath.');
    await this.run(this.commands.pdfMerge, [...paths, outputPath], signal, 128 * 1024);
    return { path: outputPath, merged: paths.length, backend: this.id };
  }

  private async extractOfficeText(format: DocumentFormat, path: string, cwd: string, signal?: AbortSignal): Promise<unknown> {
    if (this.commands.office === undefined) throw new Error('Office text extraction requires LibreOffice.');
    const root = await mkdtemp(join(cwd, '.lotagate-office-'));
    try {
      await this.run(this.commands.office, ['--headless', '--convert-to', 'txt:Text', '--outdir', root, path], signal, 512 * 1024);
      const output = join(root, `${basename(path, extname(path))}.txt`);
      return { format, text: await readFile(output, 'utf8'), backend: this.id };
    } finally { await rm(root, { recursive: true, force: true }); }
  }

  private async exportOfficePdf(path: string, params: Record<string, unknown>, cwd: string, signal?: AbortSignal): Promise<unknown> {
    if (this.commands.office === undefined) throw new Error('Office PDF export requires LibreOffice.');
    const outputPath = outputPathOf(params) ?? join(dirname(path), `${basename(path, extname(path))}.pdf`);
    const root = await mkdtemp(join(cwd, '.lotagate-office-'));
    try {
      await this.run(this.commands.office, ['--headless', '--convert-to', 'pdf', '--outdir', root, path], signal, 512 * 1024);
      const converted = join(root, `${basename(path, extname(path))}.pdf`);
      await mkdir(dirname(outputPath), { recursive: true }); await copyFile(converted, outputPath);
      return { path: outputPath, backend: this.id };
    } finally { await rm(root, { recursive: true, force: true }); }
  }

  private async exportOfficeCsv(path: string, params: Record<string, unknown>, cwd: string, signal?: AbortSignal): Promise<unknown> {
    if (this.commands.office === undefined) throw new Error('Workbook CSV export requires LibreOffice.');
    const outputPath = outputPathOf(params) ?? join(dirname(path), `${basename(path, extname(path))}.csv`);
    const root = await mkdtemp(join(cwd, '.lotagate-office-'));
    try {
      await this.run(this.commands.office, ['--headless', '--convert-to', 'csv', '--outdir', root, path], signal, 512 * 1024);
      await mkdir(dirname(outputPath), { recursive: true }); await copyFile(join(root, `${basename(path, extname(path))}.csv`), outputPath);
      return { path: outputPath, backend: this.id };
    } finally { await rm(root, { recursive: true, force: true }); }
  }

  private async renderOffice(path: string, params: Record<string, unknown>, cwd: string, signal?: AbortSignal): Promise<unknown> {
    if (this.commands.office === undefined) throw new Error('Office rendering requires LibreOffice.');
    const root = await mkdtemp(join(cwd, '.lotagate-office-'));
    try {
      await this.run(this.commands.office, ['--headless', '--convert-to', 'pdf', '--outdir', root, path], signal, 512 * 1024);
      return await this.renderPdf(join(root, `${basename(path, extname(path))}.pdf`), params, signal);
    } finally { await rm(root, { recursive: true, force: true }); }
  }

  private run(command: string, args: readonly string[], signal: AbortSignal | undefined, maxOutputBytes: number, input?: string): Promise<BoundedCommandResult> {
    return runBoundedCommand(command, args, { maxOutputBytes, timeoutMs: this.timeoutMs, ...(input === undefined ? {} : { input }), ...(signal === undefined ? {} : { signal }) });
  }

  private async executeOfficeBridge(cwd: string, format: Extract<DocumentFormat, 'pptx' | 'excel' | 'docs'>, action: string, path: string, params: Record<string, unknown>, signal?: AbortSignal): Promise<unknown | undefined> {
    const bridge = this.commands.officeBridge;
    if (bridge === undefined) return undefined;
    const result = await this.run(bridge.command, [bridge.scriptPath], signal, DOCUMENT_BACKEND_MAX_OUTPUT_BYTES, JSON.stringify({ cwd, action: `${format}.${action}`, path, params }));
    try { return JSON.parse(result.stdout.toString('utf8')) as unknown; }
    catch { throw new Error('Portable Office bridge returned invalid JSON.'); }
  }

  private async executeTextDocument(action: string, path: string, params: Record<string, unknown>): Promise<unknown> {
    if (action === 'readContent' || action === 'extractText') return { format: 'docs', content: await readFile(path, 'utf8'), backend: this.id };
    if (action === 'findReplace') {
      const find = requiredString(params, 'find');
      const replace = typeof params['replace'] === 'string' ? params['replace'] : '';
      const content = await readFile(path, 'utf8');
      const next = content.split(find).join(replace);
      await writeFile(path, next, 'utf8');
      return { operation: action, replacements: content === next ? 0 : content.split(find).length - 1, updated: content !== next, backend: this.id };
    }
    if (action === 'insertContent' || action === 'updateContent' || action === 'deleteContent') {
      const content = await readFile(path, 'utf8');
      const start = boundedOffset(params['start'], content.length);
      const end = boundedOffset(params['end'], start);
      const replacement = action === 'deleteContent' ? '' : typeof params['content'] === 'string' ? params['content'] : typeof params['text'] === 'string' ? params['text'] : '';
      const next = action === 'insertContent' ? content.slice(0, start) + replacement + content.slice(start) : content.slice(0, start) + replacement + content.slice(end);
      await writeFile(path, next, 'utf8');
      return { operation: action, updated: true, backend: this.id };
    }
    throw new Error(`The portable text backend does not support docs.${action}.`);
  }

  private async executeCsvDocument(action: string, path: string, params: Record<string, unknown>): Promise<unknown> {
    if (action === 'readRange' || action === 'readFormulas' || action === 'find' || action === 'writeRange' || action === 'clearRange' || action === 'importCsv' || action === 'exportCsv') {
      const rows = parseCsv(await readFile(path, 'utf8'));
      if (action === 'readRange' || action === 'readFormulas') {
        const range = typeof params['range'] === 'string' ? params['range'] : 'A1';
        const selected = selectCsvRange(rows, range);
        return { operation: action, sheet: 'Sheet1', range, values: selected, ...(action === 'readFormulas' ? { formulas: selected } : {}), backend: this.id };
      }
      if (action === 'find') {
        const query = requiredString(params, 'query').toLocaleLowerCase();
        const matches = rows.flatMap((row, rowIndex) => row.flatMap((value, columnIndex) => value.toLocaleLowerCase().includes(query) ? [{ sheet: 'Sheet1', row: rowIndex, column: columnIndex, value }] : [])).slice(0, 500);
        return { operation: action, query, matches, truncated: matches.length === 500, backend: this.id };
      }
      if (action === 'importCsv') {
        const sourcePath = requiredString(params, 'sourcePath');
        await writeFile(path, await readFile(sourcePath));
        return { operation: action, updated: true, backend: this.id };
      }
      if (action === 'exportCsv') {
        const outputPath = outputPathOf(params) ?? `${path}.export.csv`;
        await mkdir(dirname(outputPath), { recursive: true });
        const range = typeof params['range'] === 'string' ? params['range'] : undefined;
        if (range === undefined) await copyFile(path, outputPath);
        else await writeFile(outputPath, serializeCsv(selectCsvRange(rows, range)), 'utf8');
        return { operation: action, path: outputPath, sheet: 'Sheet1', ...(range === undefined ? {} : { range }), backend: this.id };
      }
      const next = action === 'writeRange' ? writeCsvRange(rows, requiredString(params, 'range'), params['values']) : action === 'clearRange' ? clearCsvRange(rows, requiredString(params, 'range')) : rows;
      await writeFile(path, serializeCsv(next), 'utf8');
      return { operation: action, updated: true, backend: this.id };
    }
    throw new Error(`The portable CSV backend does not support excel.${action}.`);
  }
}

function isDocumentFormat(value: string | undefined): value is DocumentFormat { return value !== undefined && DOCUMENT_FORMATS.includes(value as DocumentFormat); }
function isPlainTextDocument(format: DocumentFormat, extension: string): boolean { return (format === 'docs' && extension === '.txt') || (format === 'excel' && extension === '.csv'); }
function isRtfDocument(format: DocumentFormat, extension: string): boolean { return format === 'docs' && extension === '.rtf'; }
function isLegacyOfficeDocument(format: DocumentFormat, extension: string): boolean { return (format === 'docs' && extension === '.doc') || (format === 'excel' && extension === '.xls'); }
function outputPathOf(params: Record<string, unknown>): string | undefined { return typeof params['outputPath'] === 'string' && params['outputPath'].length > 0 ? params['outputPath'] : undefined; }
function isTextDocument(path: string): boolean { const extension = extname(path).toLowerCase(); return extension === '.txt' || extension === '.rtf'; }
function isCsvDocument(path: string): boolean { return extname(path).toLowerCase() === '.csv'; }
function requiredString(params: Record<string, unknown>, key: string): string { const value = params[key]; if (typeof value !== 'string' || value.length === 0) throw new Error(`The document operation requires ${key}.`); return value; }
function boundedOffset(value: unknown, length: number): number { return typeof value === 'number' && Number.isInteger(value) ? Math.max(0, Math.min(length, value)) : 0; }
function parseCsv(text: string): string[][] {
  const rows: string[][] = [[]]; let cell = ''; let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') { if (quoted && text[index + 1] === '"') { cell += '"'; index += 1; } else quoted = !quoted; }
    else if (character === ',' && !quoted) { rows.at(-1)!.push(cell); cell = ''; }
    else if ((character === '\n' || character === '\r') && !quoted) { if (character === '\r' && text[index + 1] === '\n') index += 1; rows.at(-1)!.push(cell); cell = ''; if (index + 1 < text.length) rows.push([]); }
    else cell += character;
  }
  if (cell.length > 0 || rows.at(-1)!.length > 0 && text.endsWith(',')) rows.at(-1)!.push(cell);
  return rows.length === 1 && rows[0]!.length === 1 && rows[0]![0] === '' && text.length === 0 ? [] : rows;
}
function serializeCsv(rows: readonly (readonly string[])[]): string { return rows.map(row => row.map(value => /[",\r\n]/u.test(value) ? `"${value.replaceAll('"', '""')}"` : value).join(',')).join('\n') + (rows.length === 0 ? '' : '\n'); }
function csvRange(range: string): { startRow: number; startColumn: number; endRow: number; endColumn: number } {
  const parts = range.replaceAll('$', '').split(':');
  const start = csvCell(parts[0] ?? 'A1'); const end = csvCell(parts[1] ?? parts[0] ?? 'A1');
  return { startRow: Math.min(start.row, end.row), startColumn: Math.min(start.column, end.column), endRow: Math.max(start.row, end.row), endColumn: Math.max(start.column, end.column) };
}
function csvCell(value: string): { row: number; column: number } {
  const match = /^([A-Za-z]+)(\d+)$/u.exec(value.trim()); if (match === null) throw new Error(`Invalid CSV range '${value}'.`);
  let column = 0; for (const character of match[1]!.toUpperCase()) column = column * 26 + character.charCodeAt(0) - 64;
  return { row: Number(match[2]) - 1, column: column - 1 };
}
function selectCsvRange(rows: readonly string[][], range: string): string[][] { const bounds = csvRange(range); return Array.from({ length: bounds.endRow - bounds.startRow + 1 }, (_row, row) => Array.from({ length: bounds.endColumn - bounds.startColumn + 1 }, (_column, column) => rows[bounds.startRow + row]?.[bounds.startColumn + column] ?? '')); }
function writeCsvRange(rows: string[][], range: string, value: unknown): string[][] { const bounds = csvRange(range); if (!Array.isArray(value) || value.some(row => !Array.isArray(row))) throw new Error('excel.writeRange requires a two-dimensional values array.'); const values = value as unknown[][]; const result = rows.map(row => [...row]); for (let row = 0; row < values.length; row += 1) for (let column = 0; column < (values[row]?.length ?? 0); column += 1) { while ((result[bounds.startRow + row] ??= []).length <= bounds.startColumn + column) result[bounds.startRow + row]!.push(''); result[bounds.startRow + row]![bounds.startColumn + column] = String(values[row]![column] ?? ''); } return result; }
function clearCsvRange(rows: string[][], range: string): string[][] { const bounds = csvRange(range); const result = rows.map(row => [...row]); for (let row = bounds.startRow; row <= bounds.endRow; row += 1) for (let column = bounds.startColumn; column <= bounds.endColumn; column += 1) if (result[row]?.[column] !== undefined) result[row]![column] = ''; return result; }
async function ensureDirectory(outputPath: string): Promise<string> { const directory = extname(outputPath).length > 0 ? dirname(outputPath) : outputPath; await mkdir(directory, { recursive: true }); return directory; }
async function readFilePrefix(path: string, length: number): Promise<Buffer> {
  const file = await open(path, 'r');
  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await file.read(buffer, 0, length, 0);
    return buffer.subarray(0, bytesRead);
  } finally { await file.close(); }
}

async function fileExists(path: string): Promise<boolean> { try { await access(path); return true; } catch { return false; } }

function createMinimalPdf(title: string): string {
  const safeTitle = title.replace(/[()\\]/gu, character => `\\${character}`);
  const content = `BT /F1 18 Tf 72 720 Td (${safeTitle}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let document = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (const [index, object] of objects.entries()) { offsets.push(document.length); document += `${index + 1} 0 obj\n${object}\nendobj\n`; }
  const xref = document.length;
  document += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) document += `${String(offset).padStart(10, '0')} 00000 n \n`;
  document += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return document;
}
