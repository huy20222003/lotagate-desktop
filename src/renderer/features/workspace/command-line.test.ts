import { describe, expect, it } from 'vitest';
import { parseCommandLine } from './command-line.js';

describe('parseCommandLine', () => {
  it('keeps quoted paths as one argument', () => {
    expect(parseCommandLine('git commit -m "message with spaces"')).toEqual({ command: 'git', args: ['commit', '-m', 'message with spaces'] });
  });

  it('rejects unfinished shell syntax instead of guessing', () => {
    expect(() => parseCommandLine('git status "')).toThrow('unfinished');
  });
});
