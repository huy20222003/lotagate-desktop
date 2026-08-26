import { describe, expect, it } from 'vitest';
import type { Activity } from '../../../contracts/ipc/v1/workspace.js';
import { mergeChatActivities } from './conversation-activities.js';

function activity(kind: Activity['kind'], text: string, turnId?: string): Activity {
  return { id: `${kind}-${text}`, taskId: 'task-1', kind, text, metadata: turnId === undefined ? {} : { turnId }, createdAt: '2026-08-26T00:00:00.000Z' };
}

describe('mergeChatActivities', () => {
  it('keeps a failed turn error in the same assistant message', () => {
    const result = mergeChatActivities([activity('user', 'Change the file'), activity('assistant', 'I changed it.', 'turn-1'), activity('error', 'Agent turn failed.', 'turn-1')]);
    expect(result).toHaveLength(2);
    expect(result[1]?.text).toBe('I changed it.\n\nAgent turn failed.');
  });

  it('keeps a failed turn as one message when no assistant text exists', () => {
    const result = mergeChatActivities([activity('user', 'Read the file'), activity('error', 'Agent turn failed.', 'turn-2')]);
    expect(result).toHaveLength(2);
    expect(result[1]?.kind).toBe('error');
  });
});
