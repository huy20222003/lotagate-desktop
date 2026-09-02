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
});
