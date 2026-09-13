// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it } from 'vitest';
import { TypingIndicator } from './TypingIndicator.js';

describe('TypingIndicator', () => {
  afterEach(() => cleanup());

  it('does not duplicate a trailing progress ellipsis before animated dots', () => {
    render(<TypingIndicator label="Running command…" />);

    expect(screen.getByText('Running command', { exact: true })).toBeInTheDocument();
    expect(screen.getByLabelText('Running command...')).toBeInTheDocument();
  });

  it('also normalizes legacy ASCII ellipses', () => {
    render(<TypingIndicator label="Running command..." />);

    expect(screen.getByText('Running command', { exact: true })).toBeInTheDocument();
  });
});
