// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FileChangeCard } from './FileChangeCard.js';

const summary = {
  additions: 3,
  deletions: 1,
  files: [{ path: 'src/example.ts', additions: 3, deletions: 1, truncated: false, lines: [] }],
};

describe('FileChangeCard', () => {
  afterEach(() => cleanup());

  it('opens the existing file changes review from the card action', () => {
    const onOpenFileChanges = vi.fn();
    render(<FileChangeCard summary={summary} onOpenFileChanges={onOpenFileChanges} />);

    const card = screen.getByRole('region', { name: 'Edited files' });
    expect(card.querySelector('.file-change-card-icon svg')).toBeInTheDocument();
    expect(card.querySelector('.file-change-card-title svg')).not.toBeInTheDocument();
    expect(card.querySelector('.file-change-card-counts .change-additions')).toHaveTextContent('+3');
    expect(card.querySelector('.file-change-card-counts .change-deletions')).toHaveTextContent('-1');
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Review' }));

    expect(onOpenFileChanges).toHaveBeenCalledWith(summary);
  });

  it('runs Undo only when a ready checkpoint is supplied', async () => {
    const onUndo = vi.fn(async () => undefined);
    render(<FileChangeCard summary={summary} undoState="ready" onUndo={onUndo} onOpenFileChanges={() => undefined} />);

    const undo = screen.getByRole('button', { name: 'Undo' });
    expect(undo).toBeEnabled();
    fireEvent.click(undo);
    expect(onUndo).toHaveBeenCalledOnce();
  });

  it.each([
    ['undone', 'Undone'],
    ['conflict', 'Conflict'],
    ['failed', 'Undo failed'],
  ] as const)('disables Undo after checkpoint state becomes %s', (undoState, label) => {
    const onUndo = vi.fn(async () => undefined);
    render(<FileChangeCard summary={summary} undoState={undoState} onUndo={onUndo} onOpenFileChanges={() => undefined} />);

    const undo = screen.getByRole('button', { name: label });
    expect(undo).toBeDisabled();
    fireEvent.click(undo);
    expect(onUndo).not.toHaveBeenCalled();
  });
});
