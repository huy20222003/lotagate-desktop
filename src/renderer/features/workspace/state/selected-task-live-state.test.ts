import { describe, expect, it } from 'vitest';
import { selectedTaskLiveState } from './selected-task-live-state.js';

describe('selectedTaskLiveState', () => {
  it('restores an active task turn when switching back to it', () => {
    expect(selectedTaskLiveState({ status: 'active', turnId: 'turn-2' })).toEqual({ thinking: true, turnId: 'turn-2' });
  });

  it('clears thinking for a completed task', () => {
    expect(selectedTaskLiveState({ status: 'completed', turnId: 'turn-1' })).toEqual({ thinking: false });
  });

  it('does not show thinking when an active task has no turn id', () => {
    expect(selectedTaskLiveState({ status: 'active', turnId: undefined })).toEqual({ thinking: false });
  });
});
