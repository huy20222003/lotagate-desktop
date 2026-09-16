// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { DESKTOP_COMMAND_TIMING_METADATA_KEY, type Activity } from '../../../../contracts/ipc/v1/workspace.js';
import { messageTiming, normalizeTurnTimingsForTask } from './conversation-timing.js';

describe('conversation timing', () => {
  it('reads completed command timing from a command result activity', () => {
    const activity = {
      id: 'assistant-1', taskId: 'task-1', kind: 'assistant' as const, text: 'Generated image saved.',
      metadata: { [DESKTOP_COMMAND_TIMING_METADATA_KEY]: { startedAt: 1_000, endedAt: 4_500 } },
      createdAt: new Date(4_500).toISOString(),
    } satisfies Activity;
    expect(messageTiming(activity, {})).toEqual({ timing: { startedAt: 1_000, endedAt: 4_500 } });
  });

  it('closes an orphaned turn timing when the task is reconciled as interrupted', () => {
    expect(normalizeTurnTimingsForTask({ 'turn-1': { startedAt: 1_000 } }, { status: 'interrupted', updatedAt: new Date(4_500).toISOString() })).toEqual({ 'turn-1': { startedAt: 1_000, endedAt: 4_500 } });
  });

  it('keeps an active turn timing live while the task is active', () => {
    const timings = { 'turn-1': { startedAt: 1_000 } };
    expect(normalizeTurnTimingsForTask(timings, { status: 'active', updatedAt: new Date(4_500).toISOString() })).toBe(timings);
  });
});
