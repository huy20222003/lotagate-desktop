import type { DesktopDocumentFormat } from '../../contracts/agent-protocol/v1/host-capabilities.js';

/**
 * Native host operation inventory.
 *
 * The CLI owns public tool schemas. Desktop owns this implementation inventory
 * so all providers derive capabilities from one source instead of maintaining
 * unrelated operation arrays.
 */
export const COMPUTER_HOST_OPERATIONS = [
  'computer.listWindows', 'computer.inspect', 'computer.screenshot',
  'computer.readText', 'computer.readSelection', 'computer.readGrid',
  'computer.recognizeText', 'computer.focus', 'computer.click', 'computer.type',
  'computer.keypress', 'computer.scroll', 'computer.drag', 'computer.selectText',
  'computer.listDisplays', 'computer.launch', 'computer.wait', 'computer.move',
  'computer.setValue', 'computer.invoke', 'computer.select',
  'computer.setToggleState', 'computer.setExpandedState', 'computer.scrollIntoView',
  'computer.setWindowState', 'computer.closeWindow', 'computer.readClipboard',
  'computer.writeClipboard', 'computer.waitForState', 'computer.manageFileDialog',
] as const;

export type ComputerHostOperation = typeof COMPUTER_HOST_OPERATIONS[number];

const PDF_OPERATIONS = [
  'pdf.open', 'pdf.create', 'pdf.inspect', 'pdf.validate', 'pdf.readText',
  'pdf.render', 'pdf.extractTables', 'pdf.recognizeText', 'pdf.search',
  'pdf.extractImages', 'pdf.manageBookmarks', 'pdf.extractLinks',
  'pdf.extractAnnotations', 'pdf.manageAttachments', 'pdf.flattenForms',
  'pdf.optimize', 'pdf.addPageNumbers', 'pdf.insertPages', 'pdf.deletePages',
  'pdf.reorderPages', 'pdf.rotatePages', 'pdf.merge', 'pdf.split', 'pdf.addText',
  'pdf.addImage', 'pdf.annotate', 'pdf.readForm', 'pdf.fillForm', 'pdf.redact',
  'pdf.save', 'pdf.close',
] as const;

const PPTX_OPERATIONS = [
  'pptx.open', 'pptx.create', 'pptx.inspect', 'pptx.validate', 'pptx.duplicateSlide',
  'pptx.importSlides', 'pptx.arrangeElements', 'pptx.findReplace',
  'pptx.extractText', 'pptx.manageMedia', 'pptx.manageHyperlinks',
  'pptx.manageTransitions', 'pptx.manageLayouts', 'pptx.readSlide', 'pptx.addSlide',
  'pptx.deleteSlide', 'pptx.reorderSlides', 'pptx.updateSlide', 'pptx.addElement',
  'pptx.updateElement', 'pptx.deleteElement', 'pptx.setTheme', 'pptx.setNotes',
  'pptx.render', 'pptx.exportPdf', 'pptx.save', 'pptx.close',
] as const;

const EXCEL_OPERATIONS = [
  'excel.open', 'excel.create', 'excel.inspect', 'excel.validate', 'excel.find',
  'excel.manageNamedRange', 'excel.setDataValidation', 'excel.managePivotTable',
  'excel.readFormulas', 'excel.manageConditionalFormatting', 'excel.manageSheetView',
  'excel.manageComments', 'excel.manageProtection', 'excel.readRange',
  'excel.writeRange', 'excel.clearRange', 'excel.addSheet', 'excel.updateSheet',
  'excel.deleteSheet', 'excel.editRows', 'excel.editColumns', 'excel.formatRange',
  'excel.manageTable', 'excel.manageChart', 'excel.sortRange', 'excel.filterRange',
  'excel.recalculate', 'excel.render', 'excel.importCsv', 'excel.exportCsv',
  'excel.exportPdf', 'excel.save', 'excel.close',
] as const;

const DOCS_OPERATIONS = [
  'docs.open', 'docs.create', 'docs.inspect', 'docs.validate', 'docs.manageTable',
  'docs.manageImage', 'docs.fillTemplate', 'docs.updateFields',
  'docs.inspectStructure', 'docs.manageBookmarks', 'docs.manageHyperlinks',
  'docs.manageLists', 'docs.manageFootnotes', 'docs.readContent',
  'docs.insertContent', 'docs.updateContent', 'docs.deleteContent',
  'docs.findReplace', 'docs.setStyles', 'docs.setSection', 'docs.setHeaderFooter',
  'docs.manageComments', 'docs.manageRevisions', 'docs.render', 'docs.exportPdf',
  'docs.save', 'docs.close',
] as const;

export const DOCUMENT_HOST_OPERATIONS: Readonly<Record<DesktopDocumentFormat, readonly string[]>> = {
  pdf: PDF_OPERATIONS,
  pptx: PPTX_OPERATIONS,
  excel: EXCEL_OPERATIONS,
  docs: DOCS_OPERATIONS,
};

export function operationsForDocumentFormat(format: DesktopDocumentFormat): readonly string[] {
  return DOCUMENT_HOST_OPERATIONS[format];
}
