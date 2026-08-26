import { describe, expect, it } from 'vitest';
import { fileChangeSummariesFromActivities, fileChangesFromActivities, mergeFileChange, mergeFileChangeSummaries } from './file-changes.js';

describe('file change projection', () => {
  it('keeps the latest change for each file and totals its lines', () => {
    const summary = fileChangesFromActivities([
      { id: '1', taskId: 'task', kind: 'file', text: 'changed', metadata: { change: { path: 'src/a.ts', additions: 3, deletions: 1, truncated: false, lines: [] } }, createdAt: new Date().toISOString() },
      { id: '2', taskId: 'task', kind: 'file', text: 'changed', metadata: { change: { path: 'src/b.ts', additions: 2, deletions: 4, truncated: false, lines: [] } }, createdAt: new Date().toISOString() },
    ]);
    expect(summary).toMatchObject({ additions: 5, deletions: 5, files: [{ path: 'src/a.ts' }, { path: 'src/b.ts' }] });
  });

  it('ignores malformed changes', () => expect(mergeFileChange({ files: [], additions: 0, deletions: 0 }, { path: '', lines: [] })).toEqual({ files: [], additions: 0, deletions: 0 }));

  it('groups changes by the response turn', () => {
    const summaries = fileChangeSummariesFromActivities([
      { id: '1', taskId: 'task', kind: 'file', text: 'changed', metadata: { turnId: 'turn-1', change: { path: 'test.md', additions: 1, deletions: 0, lines: [] } }, createdAt: new Date().toISOString() },
      { id: '2', taskId: 'task', kind: 'file', text: 'changed', metadata: { turnId: 'turn-2', change: { path: 'other.md', additions: 2, deletions: 1, lines: [] } }, createdAt: new Date().toISOString() },
    ]);
    expect(summaries['turn-1']).toMatchObject({ additions: 1, deletions: 0, files: [{ path: 'test.md' }] });
    expect(summaries['turn-2']).toMatchObject({ additions: 2, deletions: 1, files: [{ path: 'other.md' }] });
  });

  it('preserves live changes when an older activity snapshot arrives', () => {
    const merged = mergeFileChangeSummaries(
      { 'turn-1': { files: [{ path: 'live.md', additions: 2, deletions: 0, truncated: false, lines: [] }], additions: 2, deletions: 0 } },
      { 'turn-1': { files: [{ path: 'live.md', additions: 1, deletions: 0, truncated: false, lines: [] }, { path: 'snapshot.md', additions: 1, deletions: 0, truncated: false, lines: [] }], additions: 2, deletions: 0 } },
    );
    expect(merged['turn-1']).toMatchObject({ additions: 3, deletions: 0, files: [{ path: 'live.md' }, { path: 'snapshot.md' }] });
    expect(merged['turn-1']?.files[0]?.additions).toBe(2);
  });
});
