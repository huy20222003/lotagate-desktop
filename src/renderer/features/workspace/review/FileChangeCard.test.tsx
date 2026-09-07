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

const multiFileSummary = {
  additions: 7,
  deletions: 4,
  files: [
    { path: 'src/first.ts', additions: 1, deletions: 0, truncated: false, lines: [] },
    { path: 'src/second.ts', additions: 2, deletions: 1, truncated: false, lines: [] },
    { path: 'src/third.ts', additions: 3, deletions: 2, truncated: false, lines: [] },
    { path: 'src/fourth.ts', additions: 1, deletions: 1, truncated: false, lines: [] },
  ],
};

const emptyDiffSummary = {
  additions: 0,
  deletions: 0,
  files: [{ path: 'test.md', additions: 0, deletions: 0, truncated: false, lines: [] }],
};

describe('FileChangeCard', () => {
  afterEach(() => cleanup());

  it('opens the existing file changes review from the card or action', () => {
    const onOpenFileChanges = vi.fn();
    render(<FileChangeCard summary={summary} onOpenFileChanges={onOpenFileChanges} />);

    const card = screen.getByRole('region', { name: 'Edited files' });
    expect(card.querySelector('.file-change-card-icon svg')).toBeInTheDocument();
    expect(card.querySelector('.file-change-card-title svg')).not.toBeInTheDocument();
    expect(card).toHaveTextContent('Edited example.ts');
    expect(card.querySelector('.file-change-card-list')).not.toBeInTheDocument();
    expect(card.querySelector('.file-change-card-counts .change-additions')).toHaveTextContent('+3');
    expect(card.querySelector('.file-change-card-counts .change-deletions')).toHaveTextContent('-1');
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled();
    fireEvent.click(card);
    expect(onOpenFileChanges).toHaveBeenCalledWith(summary);
    fireEvent.click(screen.getByRole('button', { name: 'Review' }));

    expect(onOpenFileChanges).toHaveBeenCalledTimes(2);
  });

  it('does not open the drawer twice when an action button is clicked', () => {
    const onOpenFileChanges = vi.fn();
    render(<FileChangeCard summary={summary} onOpenFileChanges={onOpenFileChanges} />);

    fireEvent.click(screen.getByRole('button', { name: 'Review' }));

    expect(onOpenFileChanges).toHaveBeenCalledOnce();
  });

  it('hides zero diff counts while keeping the file review available', () => {
    const onOpenFileChanges = vi.fn();
    render(<FileChangeCard summary={emptyDiffSummary} onOpenFileChanges={onOpenFileChanges} />);

    const card = screen.getByRole('region', { name: 'Edited files' });
    expect(card.querySelector('.file-change-card-counts')).not.toBeInTheDocument();
    expect(card).toHaveTextContent('Edited test.md');
    expect(screen.getByRole('button', { name: 'Review' })).toBeInTheDocument();
  });

  it('shows three changed files and expands the remaining file list on demand', () => {
    const onOpenFileChanges = vi.fn();
    render(<FileChangeCard summary={multiFileSummary} onOpenFileChanges={onOpenFileChanges} />);

    const card = screen.getByRole('region', { name: 'Edited files' });
    expect(card.querySelectorAll('.file-change-item')).toHaveLength(3);
    expect(screen.queryByText('src/fourth.ts')).not.toBeInTheDocument();
    const more = screen.getByRole('button', { name: 'Show 1 more files' });
    expect(more).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(more);

    expect(card.querySelectorAll('.file-change-item')).toHaveLength(4);
    expect(screen.getByText('src/fourth.ts')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show fewer files' })).toHaveAttribute('aria-expanded', 'true');

    fireEvent.click(screen.getByRole('button', { name: 'src/first.ts' }));
    expect(onOpenFileChanges).toHaveBeenCalledWith(multiFileSummary, 'src/first.ts');
    fireEvent.click(card.querySelector('.file-change-item-header')!);
    expect(onOpenFileChanges).toHaveBeenLastCalledWith(multiFileSummary);
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
