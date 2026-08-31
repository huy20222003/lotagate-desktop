import { describe, expect, it } from 'vitest';
import { isReadOnlyCommand } from './command-policy.js';

describe('command policy', () => {
  it('recognizes read-only file and git commands', () => {
    expect(isReadOnlyCommand('Get-Content', ['README.md'])).toBe(true);
    expect(isReadOnlyCommand('git', ['diff'])).toBe(true);
  });

  it('does not classify a compound command from a matching argument as read-only', () => {
    expect(isReadOnlyCommand('powershell.exe', ['-Command', 'Get-Content README.md; Remove-Item output.txt'])).toBe(false);
    expect(isReadOnlyCommand('git', ['diff', '--output=changes.patch'])).toBe(false);
  });

  it('does not classify mutating commands as read-only', () => {
    expect(isReadOnlyCommand('Set-Content', ['README.md'])).toBe(false);
    expect(isReadOnlyCommand('git', ['commit', '-m', 'change'])).toBe(false);
  });
});
