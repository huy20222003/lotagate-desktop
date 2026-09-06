import { describe, expect, it } from 'vitest';
import type { Activity } from '../../../../contracts/ipc/v1/workspace.js';
import { getConversationTimeSeparatorIds } from './conversation-time.js';

function activity(id: string, kind: Activity['kind'], createdAt: string): Activity {
  return { id, taskId: 'task-1', kind, text: id, metadata: {}, createdAt };
}

describe('conversation time separators', () => {
  it('marks the first user message', () => {
    const messages = [activity('user-1', 'user', '2026-08-22T10:00:00.000Z')];

    expect([...getConversationTimeSeparatorIds(messages)]).toEqual(['user-1']);
  });

  it('marks a user message exactly three hours after the previous agent response', () => {
    const messages = [
      activity('user-1', 'user', '2026-08-22T10:00:00.000Z'),
      activity('assistant-1', 'assistant', '2026-08-22T10:30:00.000Z'),
      activity('user-2', 'user', '2026-08-22T13:30:00.000Z'),
    ];

    expect([...getConversationTimeSeparatorIds(messages)]).toEqual(['user-1', 'user-2']);
  });

  it('does not mark a user message before the three-hour threshold', () => {
    const messages = [
      activity('user-1', 'user', '2026-08-22T10:00:00.000Z'),
      activity('assistant-1', 'assistant', '2026-08-22T10:30:00.000Z'),
      activity('user-2', 'user', '2026-08-22T13:29:59.999Z'),
    ];

    expect([...getConversationTimeSeparatorIds(messages)]).toEqual(['user-1']);
  });
});
