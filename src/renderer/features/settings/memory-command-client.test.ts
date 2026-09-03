import { describe, expect, it } from 'vitest';
import { parseMemoryRows } from './memory-command-client.js';

describe('memory command output parser', () => {
  it('accepts only the typed local-memory payload produced by CLI command.*', () => {
    expect(parseMemoryRows({ kind: 'memory.list', items: [{ id: 'memory-1', kind: 'lesson', state: 'active', statement: 'Run typecheck', rationale: 'Evidence-backed workflow', topics: ['cli'], source: 'host-evidence', evidenceRefs: ['evidence-1'], supersedes: [], createdAt: '2026-09-02T00:00:00.000Z', updatedAt: '2026-09-03T00:00:00.000Z', retrievalCount: 2 }] })).toEqual([{ id: 'memory-1', kind: 'lesson', state: 'active', statement: 'Run typecheck', rationale: 'Evidence-backed workflow', topics: ['cli'], source: 'host-evidence', evidenceRefs: ['evidence-1'], supersedes: [], createdAt: '2026-09-02T00:00:00.000Z', updatedAt: '2026-09-03T00:00:00.000Z', retrievalCount: 2 }]);
  });

  it('rejects malformed structured command output', () => {
    expect(parseMemoryRows({ kind: 'memory.list', items: [{ id: 'bad' }] })).toEqual([]);
  });
});
