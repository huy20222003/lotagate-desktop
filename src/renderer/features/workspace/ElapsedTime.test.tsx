// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it } from 'vitest';
import { ElapsedTime } from './ElapsedTime.js';

describe('ElapsedTime', () => {
  afterEach(() => cleanup());

  it('opens the current turn and closes it when the turn completes', () => {
    const view = render(<ElapsedTime timing={{ startedAt: 1_000 }} fallback="2026-08-30T00:00:00.000Z" statusText="Checking the workspace." />);
    const details = view.container.querySelector('details');
    expect(details).toHaveAttribute('open');

    view.rerender(<ElapsedTime timing={{ startedAt: 1_000, endedAt: 2_000 }} fallback="2026-08-30T00:00:00.000Z" statusText="Checking the workspace." />);
    expect(details).not.toHaveAttribute('open');
  });
});
