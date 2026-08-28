import { describe, expect, it } from 'vitest';
import { BUILTIN_TOOL_DISPLAY_NAMES, formatToolDisplayName } from './tool-display.js';

describe('tool display names', () => {
  it('covers the complete 31-tool built-in catalog', () => {
    expect(Object.keys(BUILTIN_TOOL_DISPLAY_NAMES)).toHaveLength(31);
  });

  it('prefers the canonical Desktop label over a protocol label', () => {
    expect(formatToolDisplayName('browser.newTab', 'browser.newTab')).toBe('Open new tab');
    expect(formatToolDisplayName('filesystem.read', undefined)).toBe('Read file');
    expect(formatToolDisplayName('filesystem.read', 'Read a UTF-8 text file')).toBe('Read a UTF-8 text file');
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
