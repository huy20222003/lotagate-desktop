import { describe, expect, it } from 'vitest';
import { BUILTIN_TOOL_DISPLAY_NAMES, formatToolDisplayName } from './tool-display.js';

describe('tool display names', () => {
  it('covers the complete built-in catalog', () => {
    expect(Object.keys(BUILTIN_TOOL_DISPLAY_NAMES)).toEqual(expect.arrayContaining([
      'filesystem.read', 'shell.exec', 'browser.navigate', 'computer.inspect',
      'pdf.open', 'pptx.open', 'excel.open', 'docs.open',
      'browser.extractTable', 'browser.listFrames', 'browser.exportPdf',
      'computer.readSelection', 'computer.readGrid', 'computer.selectText', 'computer.listDisplays',
      'pdf.recognizeText', 'pdf.search', 'pdf.extractImages', 'pdf.manageBookmarks', 'pdf.extractLinks', 'pdf.extractAnnotations', 'pdf.manageAttachments', 'pdf.flattenForms', 'pdf.optimize', 'pdf.addPageNumbers',
      'pptx.duplicateSlide', 'pptx.importSlides', 'pptx.arrangeElements', 'pptx.findReplace',
      'excel.find', 'excel.manageNamedRange', 'excel.setDataValidation', 'excel.managePivotTable',
      'docs.manageTable', 'docs.manageImage', 'docs.fillTemplate', 'docs.updateFields',
    ]));
  });

  it('prefers the canonical Desktop label over a protocol label', () => {
    expect(formatToolDisplayName('browser.newTab', 'browser.newTab')).toBe('Open new tab');
    expect(formatToolDisplayName('filesystem.read', undefined)).toBe('Read file');
    expect(formatToolDisplayName('filesystem.read', 'Read a UTF-8 text file')).toBe('Read a UTF-8 text file');
    expect(formatToolDisplayName('work_plan.update', 'work_plan.update')).toBe('Update work plan');
  });

  it('preserves a friendly MCP label and humanizes an unlabelled MCP tool', () => {
    expect(formatToolDisplayName('mcp__tavily__tavily_search', 'Tavily Search')).toBe('Tavily Search');
    expect(formatToolDisplayName('mcp__tavily__tavily_search', 'mcp__tavily__tavily_search')).toBe('Tavily Search');
  });

  it('humanizes unknown tool ids without exposing the raw separator format', () => {
    expect(formatToolDisplayName('custom.sync_files', undefined)).toBe('Custom Sync Files');
    expect(formatToolDisplayName(undefined, undefined)).toBe('Tool');
  });
});
