// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useTaskSidebarStatus } from './use-task-sidebar-status.js';

describe('useTaskSidebarStatus', () => {
  it('tracks running turns and marks completed turns unread when another task is selected', () => {
    const { result, rerender } = renderHook(({ selectedTaskId }) => useTaskSidebarStatus(selectedTaskId), { initialProps: { selectedTaskId: 'current' } });

    act(() => result.current.markTurnStarted('other'));
    expect(result.current.runningTaskIds.has('other')).toBe(true);
    act(() => result.current.markTurnFinished('other', true, 'current'));
    expect(result.current.runningTaskIds.has('other')).toBe(false);
    expect(result.current.unreadTaskIds.has('other')).toBe(true);

    rerender({ selectedTaskId: 'other' });
    expect(result.current.unreadTaskIds.has('other')).toBe(false);
  });

  it('clears a cancelled turn from the sidebar without marking it unread', () => {
    const { result } = renderHook(() => useTaskSidebarStatus('current'));

    act(() => result.current.markTurnStarted('current'));
    act(() => result.current.markTurnFinished('current', false, 'current'));

    expect(result.current.runningTaskIds.has('current')).toBe(false);
    expect(result.current.unreadTaskIds.has('current')).toBe(false);
  });
});
