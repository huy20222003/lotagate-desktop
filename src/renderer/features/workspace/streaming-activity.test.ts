import { describe, expect, it } from 'vitest';
import type { Activity } from '../../../contracts/ipc/v1/workspace.js';
import { appendAssistantDelta, assistantStreamKey, isAssistantStreamPersisted, reconcilePendingAssistantStreams, type PendingAssistantStream } from './streaming-activity.js';

const createdAt = '2026-08-27T00:00:00.000Z';

function activity(id: string, text: string, turnId = 'turn-1'): Activity {
  return { id, taskId: 'task-1', kind: 'assistant', text, metadata: { turnId }, createdAt };
}

describe('streaming activity projection', () => {
  it('renders the first delta immediately and appends later deltas to the same turn', () => {
    const first = appendAssistantDelta([], { taskId: 'task-1', turnId: 'turn-1', content: 'Hel', createdAt });
    const next = appendAssistantDelta(first, { taskId: 'task-1', turnId: 'turn-1', content: 'lo', createdAt });

    expect(next).toHaveLength(1);
    expect(next[0]?.text).toBe('Hello');
    expect(next[0]?.metadata).toMatchObject({ turnId: 'turn-1' });
  });

  it('keeps streams from separate turns independent', () => {
    const first = appendAssistantDelta([activity('assistant-1', 'Done', 'turn-1')], { taskId: 'task-1', turnId: 'turn-2', content: 'Next', createdAt });

    expect(first).toHaveLength(2);
    expect(first[1]?.text).toBe('Next');
    expect(assistantStreamKey('task-1', 'turn-1')).not.toBe(assistantStreamKey('task-1', 'turn-2'));
  });

  it('overlays a stream while persistence is catching up, then allows reconciliation', () => {
    const stream: PendingAssistantStream = { taskId: 'task-1', turnId: 'turn-1', text: 'Hello world', createdAt };
    const stale = [activity('assistant-1', 'Hello', 'turn-1')];
    const overlay = reconcilePendingAssistantStreams(stale, [stream]);

    expect(overlay[0]?.text).toBe('Hello world');
    expect(isAssistantStreamPersisted([activity('assistant-1', 'Hello world', 'turn-1')], stream)).toBe(true);
  });
});
