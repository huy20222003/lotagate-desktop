import { describe, expect, it } from 'vitest';
import { agentStatusForEvent } from './agent-status.js';

describe('agentStatusForEvent', () => {
  it('places completion status immediately after the canonical tool name', () => {
    expect(agentStatusForEvent('tool.completed', { toolName: 'browser.newTab', displayName: 'browser.newTab' })).toBe('Open new tab · completed');
    expect(agentStatusForEvent('tool.completed', { toolName: 'mcp__tavily__tavily_search', displayName: 'Tavily Search' })).toBe('Tavily Search · completed');
  });

  it('places failure status immediately after the canonical tool name', () => {
    expect(agentStatusForEvent('tool.completed', { toolName: 'browser.newTab', displayName: 'browser.newTab', isError: true })).toBe('Open new tab · failed');
  });

  it('uses the same canonical label while a tool is running', () => {
    expect(agentStatusForEvent('tool.started', { toolName: 'filesystem.read', displayName: 'filesystem.read', kind: 'filesystem' })).toBe('I’ll inspect the workspace with Read file.');
  });
});
