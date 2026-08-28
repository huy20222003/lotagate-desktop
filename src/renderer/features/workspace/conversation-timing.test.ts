// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { DESKTOP_COMMAND_TIMING_METADATA_KEY, type Activity } from '../../../contracts/ipc/v1/workspace.js';
import { messageTiming } from './conversation-timing.js';

describe('conversation timing', () => {
  it('reads completed command timing from a command result activity', () => {
    const activity = {
      id: 'assistant-1', taskId: 'task-1', kind: 'assistant' as const, text: 'Generated image saved.',
      metadata: { [DESKTOP_COMMAND_TIMING_METADATA_KEY]: { startedAt: 1_000, endedAt: 4_500 } },
      createdAt: new Date(4_500).toISOString(),
    } satisfies Activity;
    expect(messageTiming(activity, {})).toEqual({ timing: { startedAt: 1_000, endedAt: 4_500 } });
  });
});
