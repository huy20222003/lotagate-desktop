import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { PortableDocumentBackend } from './portable-document-backend.js';

describe('PortableDocumentBackend', () => {
  it('validates portable document signatures without loading the whole file', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lotagate-portable-documents-'));
    try {
      await writeFile(join(root, 'report.pdf'), '%PDF-1.7\n');
      await writeFile(join(root, 'slides.pptx'), Buffer.from('PK\x03\x04portable'));
      await writeFile(join(root, 'workbook.xls'), Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]));
      await writeFile(join(root, 'data.csv'), 'name,value\nLotaGate,1\n');
      await writeFile(join(root, 'notes.rtf'), '{\\rtf1\\ansi portable}');

      const backend = new PortableDocumentBackend({});
      await expect(backend.execute(root, { action: 'pdf.validate', path: join(root, 'report.pdf'), params: {} })).resolves.toMatchObject({ valid: true, format: 'pdf' });
      await expect(backend.execute(root, { action: 'pptx.validate', path: join(root, 'slides.pptx'), params: {} })).resolves.toMatchObject({ valid: true, format: 'pptx' });
      await expect(backend.execute(root, { action: 'excel.validate', path: join(root, 'workbook.xls'), params: {} })).resolves.toMatchObject({ valid: true, format: 'excel' });
      await expect(backend.execute(root, { action: 'excel.validate', path: join(root, 'data.csv'), params: {} })).resolves.toMatchObject({ valid: true, format: 'excel' });
      await expect(backend.execute(root, { action: 'docs.validate', path: join(root, 'notes.rtf'), params: {} })).resolves.toMatchObject({ valid: true, format: 'docs' });
      expect(backend.capabilities.pptx?.operations).toEqual(expect.arrayContaining(['pptx.open', 'pptx.inspect', 'pptx.validate', 'pptx.save', 'pptx.close']));
      expect(backend.capabilities.pptx?.operations).not.toContain('pptx.extractText');
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('keeps text documents and CSV workbooks usable without optional Office runtimes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lotagate-portable-document-fallback-'));
    try {
      const notes = join(root, 'notes.txt');
      const csv = join(root, 'data.csv');
      await writeFile(notes, 'hello world');
      await writeFile(csv, 'name,value\nLotaGate,1\n');
      const backend = new PortableDocumentBackend({});
      await expect(backend.execute(root, { action: 'docs.readContent', path: notes, params: {} })).resolves.toMatchObject({ content: 'hello world' });
      await expect(backend.execute(root, { action: 'excel.readRange', path: csv, params: { range: 'A1:B2' } })).resolves.toMatchObject({ values: [['name', 'value'], ['LotaGate', '1']] });
      const exported = join(root, 'selected.csv');
      await expect(backend.execute(root, { action: 'excel.exportCsv', path: csv, params: { range: 'B1:B2', outputPath: exported } })).resolves.toMatchObject({ operation: 'exportCsv', sheet: 'Sheet1', range: 'B1:B2' });
      await expect(readFile(exported, 'utf8')).resolves.toBe('value\n1\n');
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('executes PDF text, image, and annotation edits through the embedded adapter', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lotagate-portable-pdf-editor-'));
    try {
      const path = join(root, 'edited.pdf');
      const imagePath = join(root, 'image.png');
      const document = await PDFDocument.create();
      document.addPage([300, 300]);
      await writeFile(path, await document.save());
      await writeFile(imagePath, Buffer.from('not-an-image'));
      const backend = new PortableDocumentBackend({ pdfEditor: 'embedded' });
      await expect(backend.execute(root, { action: 'pdf.addText', path, params: { page: 0, text: 'hello', x: 10, y: 10 } })).resolves.toMatchObject({ updated: true, operation: 'addText' });
      await expect(backend.execute(root, { action: 'pdf.annotate', path, params: { page: 0, text: 'note', x: 10, y: 10 } })).resolves.toMatchObject({ updated: true, operation: 'annotate' });
      await expect(backend.execute(root, { action: 'pdf.addImage', path, params: { page: 0, imagePath, x: 10, y: 10, width: 20, height: 20 } })).rejects.toThrow('PNG or JPEG');
      await expect(PDFDocument.load(await readFile(path))).resolves.toHaveProperty('getPageCount');
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
