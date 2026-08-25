import { describe, expect, it } from 'vitest';
import { isReadOnlyCommand } from './command-policy.js';

describe('command policy', () => {
  it('recognizes read-only file and git commands', () => {
    expect(isReadOnlyCommand('Get-Content', ['README.md'])).toBe(true);
    expect(isReadOnlyCommand('git', ['diff'])).toBe(true);
  });

  it('does not classify mutating commands as read-only', () => {
    expect(isReadOnlyCommand('Set-Content', ['README.md'])).toBe(false);
    expect(isReadOnlyCommand('git', ['commit', '-m', 'change'])).toBe(false);
  });
});
