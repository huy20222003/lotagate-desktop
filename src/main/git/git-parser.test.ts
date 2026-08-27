import { describe, expect, it } from 'vitest';
import { parseBranches, parseHistory, parseStashes, parseStatusV2 } from './git-parser.js';

describe('Git parsers', () => {
  it('parses branch metadata and staged, unstaged, rename, and conflict records', () => {
    const output = [
      '# branch.head main',
      '# branch.upstream origin/main',
      '# branch.ab +2 -1',
      '1 .M N... 100644 100644 100644 aaa aaa src/file.ts',
      '1 M. N... 100644 100644 100644 bbb bbb staged.ts',
      '2 R. N... 100644 100644 100644 ccc ddd R100 renamed.ts',
      'old name.ts',
      'u UU N... 100644 100644 100644 100644 aaa bbb ccc ddd conflict.ts',
      '? untracked file.txt',
    ].join('\0') + '\0';

    const snapshot = parseStatusV2(output, 'C:/repo', 0, '');
    expect(snapshot.branch).toBe('main');
    expect(snapshot.upstream).toBe('origin/main');
    expect(snapshot.ahead).toBe(2);
    expect(snapshot.behind).toBe(1);
    expect(snapshot.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'src/file.ts', status: 'modified', staged: false, unstaged: true }),
      expect.objectContaining({ path: 'staged.ts', staged: true, unstaged: false }),
      expect.objectContaining({ path: 'renamed.ts', originalPath: 'old name.ts', status: 'renamed' }),
      expect.objectContaining({ path: 'conflict.ts', status: 'conflicted' }),
      expect.objectContaining({ path: 'untracked file.txt', status: 'untracked' }),
    ]));
    expect(snapshot.conflicts).toBe(1);
  });

  it('parses branches, commits, and stashes from nul-delimited output', () => {
    expect(parseBranches('main\t*\torigin/main\t[ahead 2, behind 1]\0feature\t \t\t\0')).toEqual([
      { name: 'main', current: true, remote: false, upstream: 'origin/main', ahead: 2, behind: 1 },
      { name: 'feature', current: false, remote: false, ahead: 0, behind: 0 },
    ]);
    expect(parseHistory('abc\x1fabc\x1fInitial commit\x1fNguyen\x1f2026-08-27T10:00:00Z\x1f\0')).toEqual([{ hash: 'abc', shortHash: 'abc', subject: 'Initial commit', author: 'Nguyen', authoredAt: '2026-08-27T10:00:00Z', parents: [] }]);
    expect(parseStashes('stash@{0} WIP changes\0')).toEqual([{ reference: 'stash@{0}', message: 'WIP changes' }]);
  });
});
