import { describe, expect, it } from 'vitest';
import { fileChangesFromActivities, mergeFileChange } from './file-changes.js';

describe('file change projection', () => {
  it('keeps the latest change for each file and totals its lines', () => {
    const summary = fileChangesFromActivities([
      { id: '1', taskId: 'task', kind: 'file', text: 'changed', metadata: { change: { path: 'src/a.ts', additions: 3, deletions: 1, truncated: false, lines: [] } }, createdAt: new Date().toISOString() },
      { id: '2', taskId: 'task', kind: 'file', text: 'changed', metadata: { change: { path: 'src/b.ts', additions: 2, deletions: 4, truncated: false, lines: [] } }, createdAt: new Date().toISOString() },
    ]);
    expect(summary).toMatchObject({ additions: 5, deletions: 5, files: [{ path: 'src/a.ts' }, { path: 'src/b.ts' }] });
  });

  it('ignores malformed changes', () => expect(mergeFileChange({ files: [], additions: 0, deletions: 0 }, { path: '', lines: [] })).toEqual({ files: [], additions: 0, deletions: 0 }));
});
