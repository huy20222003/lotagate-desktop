import { describe, expect, it } from 'vitest';
import { parseMemoryRows } from './memory-command-client.js';

describe('memory command output parser', () => {
  it('accepts only the typed local-memory payload produced by CLI command.*', () => {
    expect(parseMemoryRows({ kind: 'memory.list', items: [{ id: 'memory-1', scope: 'project', kind: 'episodic', status: 'verified', statement: 'Run typecheck', evidenceRefs: ['evidence-1'], updatedAt: '2026-09-03T00:00:00.000Z', useCount: 2 }] })).toEqual([{ id: 'memory-1', kind: 'episodic', status: 'verified', statement: 'Run typecheck', evidenceRefs: ['evidence-1'], updatedAt: '2026-09-03T00:00:00.000Z', useCount: 2 }]);
  });

  it('rejects malformed structured command output', () => {
    expect(parseMemoryRows({ kind: 'memory.list', items: [{ id: 'bad' }] })).toEqual([]);
  });
});
