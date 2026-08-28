// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useDebounce } from './use-debounce.js';

describe('useDebounce', () => {
  it('publishes the latest value after the configured delay', () => {
    vi.useFakeTimers();
    try {
      const { result, rerender } = renderHook(({ value }) => useDebounce(value, 100), { initialProps: { value: 'first' } });
      rerender({ value: 'second' });
      expect(result.current).toBe('first');
      act(() => { vi.advanceTimersByTime(100); });
      expect(result.current).toBe('second');
    } finally { vi.useRealTimers(); }
  });
});
