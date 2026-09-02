// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { act, render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SessionTitle } from './SessionTitle.js';

describe('SessionTitle', () => {
  it('duplicates an overflowing title for the marquee track', () => {
    let measureOverflow: (() => void) | undefined;
    class TestResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        measureOverflow = () => callback([], this as unknown as ResizeObserver);
      }
      observe() {}
      disconnect() {}
    }
    Object.defineProperty(globalThis, 'ResizeObserver', { configurable: true, value: TestResizeObserver });

    const view = render(<SessionTitle title="A session title that does not fit in the sidebar" />);
    const viewport = view.container.querySelector('.session-title-viewport');
    if (!viewport) throw new Error('Session title viewport was not rendered.');
    Object.defineProperties(viewport, { clientWidth: { configurable: true, value: 120 }, scrollWidth: { configurable: true, value: 240 } });

    act(() => measureOverflow?.());

    expect(viewport).toHaveClass('is-overflowing');
    expect(viewport.querySelectorAll('.session-title-track > span')).toHaveLength(2);
  });
});
