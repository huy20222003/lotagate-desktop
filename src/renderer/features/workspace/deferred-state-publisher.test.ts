// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useDeferredStatePublisher } from './deferred-state-publisher.js';

describe('useDeferredStatePublisher', () => {
  it('coalesces explicitly deferred updates for non-stream state', () => {
    vi.useFakeTimers();
    try {
      const published: string[] = [];
      const { result } = renderHook(() => useDeferredStatePublisher((value: string) => published.push(value)));

      act(() => {
        result.current('first', true);
        result.current('second', true);
        result.current('last', true);
      });

      expect(published).toEqual([]);
      act(() => { vi.advanceTimersByTime(16); });
      expect(published).toEqual(['last']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('publishes immediate updates individually for live stream callers', () => {
    const published: string[] = [];
    const { result } = renderHook(() => useDeferredStatePublisher((value: string) => published.push(value)));

    act(() => {
      result.current('first');
      result.current('second');
      result.current('last');
    });

    expect(published).toEqual(['first', 'second', 'last']);
  });
});
