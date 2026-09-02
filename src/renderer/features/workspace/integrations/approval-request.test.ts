import { describe, expect, it } from 'vitest';
import { createComposerApprovalInput } from './approval-request.js';

describe('createComposerApprovalInput', () => {
  it('creates the shared Composer approval shape with safe defaults', () => {
    expect(createComposerApprovalInput({ source: 'browser', toolName: 'browser.navigate', displayName: 'Navigate browser', kind: 'browser', summary: 'Navigate to https://example.com', workspaceCwd: 'C:/workspace' })).toEqual({
      source: 'browser',
      surface: 'composer',
      toolName: 'browser.navigate',
      displayName: 'Navigate browser',
      kind: 'browser',
      detail: { summary: 'Navigate to https://example.com' },
      risk: 'normal',
      workspaceCwd: 'C:/workspace',
    });
  });

  it('preserves elevated risk for dangerous Git actions', () => {
    expect(createComposerApprovalInput({ source: 'git', toolName: 'git.push', kind: 'git', summary: 'Publish changes.', risk: 'elevated', workspaceCwd: 'C:/workspace' })).toMatchObject({ source: 'git', surface: 'composer', risk: 'elevated' });
  });
});
