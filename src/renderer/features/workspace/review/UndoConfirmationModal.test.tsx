// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UndoConfirmationModal } from './UndoConfirmationModal.js';

describe('UndoConfirmationModal', () => {
  afterEach(() => cleanup());

  it('explains retention and confirms the undo action', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(<UndoConfirmationModal busy={false} onCancel={onCancel} onConfirm={onConfirm} />);

    expect(screen.getByRole('dialog', { name: 'Undo file changes' })).toHaveTextContent('retained for up to 30 days');
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it('prevents closing or confirming while undo is running', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(<UndoConfirmationModal busy onCancel={onCancel} onConfirm={onConfirm} />);

    expect(screen.getByRole('button', { name: 'Undoing…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onCancel).not.toHaveBeenCalled();
  });
});
