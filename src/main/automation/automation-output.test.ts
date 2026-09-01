import { describe, expect, it } from 'vitest';
import type { Activity } from '../../contracts/ipc/v1/workspace.js';
import { finalAutomationSummary } from './automation-output.js';

function activity(kind: Activity['kind'], text: string, metadata: Record<string, unknown> = {}): Activity {
  return { id: `${kind}-${text}`, taskId: 'task-1', kind, text, metadata, createdAt: '2026-09-01T00:00:00.000Z' };
}

describe('finalAutomationSummary', () => {
  it('returns the latest completed final assistant response', () => {
    expect(finalAutomationSummary([
      activity('assistant', 'Progress output', { assistantPhase: 'progress' }),
      activity('tool', 'Read files'),
      activity('assistant', '  Automation test thành công.  ', { assistantPhase: 'final' }),
    ])).toBe('Automation test thành công.');
  });

  it('ignores progress-only and empty assistant activities', () => {
    expect(finalAutomationSummary([
      activity('assistant', 'Progress output', { assistantPhase: 'progress' }),
      activity('assistant', '  ', { assistantPhase: 'final' }),
    ])).toBeUndefined();
  });

  it('limits the persisted summary to the run contract maximum', () => {
    const summary = finalAutomationSummary([activity('assistant', 'x'.repeat(9_000), { assistantPhase: 'final' })]);
    expect(summary).toHaveLength(8_192);
  });
});
