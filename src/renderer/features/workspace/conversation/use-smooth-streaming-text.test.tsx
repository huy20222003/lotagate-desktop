// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useSmoothStreamingText } from './use-smooth-streaming-text.js';

function StreamProbe({ target, active }: { target: string; active: boolean }) {
  return <output data-testid="stream-output">{useSmoothStreamingText(target, active)}</output>;
}

describe('useSmoothStreamingText', () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('reveals a long live response over frame-sized updates', () => {
    vi.useFakeTimers();
    const target = 'Xin chào 👋 '.repeat(20).trimEnd();
    render(<StreamProbe target={target} active />);
    const output = screen.getByTestId('stream-output');

    expect(output.textContent).not.toBe(target);
    const firstLength = Array.from(output.textContent ?? '').length;
    act(() => vi.advanceTimersByTime(16));
    expect(Array.from(output.textContent ?? '').length).toBeGreaterThan(firstLength);
    for (let frame = 0; frame < 30; frame += 1) act(() => vi.advanceTimersByTime(16));
    expect(output).toHaveTextContent(target);
  });

  it('renders persisted messages in full immediately', () => {
    const target = 'Nội dung đã hoàn tất 👋';
    render(<StreamProbe target={target} active={false} />);
    expect(screen.getByTestId('stream-output')).toHaveTextContent(target);
  });

  it('finishes the reveal when a live message becomes persisted', () => {
    vi.useFakeTimers();
    const target = 'Nội dung live dài cần được hiển thị đầy đủ sau khi lượt chạy kết thúc. '.repeat(3).trimEnd();
    const view = render(<StreamProbe target={target} active />);
    expect(screen.getByTestId('stream-output')).not.toHaveTextContent(target);

    view.rerender(<StreamProbe target={target} active={false} />);

    expect(screen.getByTestId('stream-output')).toHaveTextContent(target);
  });
});
