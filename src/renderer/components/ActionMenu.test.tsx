// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';
import { Pencil } from 'lucide-react';
import { ActionMenu } from './ActionMenu.js';

describe('ActionMenu', () => {
  it('renders reusable menu items and invokes the selected action', () => {
    const onRename = vi.fn();
    render(<ActionMenu ariaLabel="Session actions" items={[{ label: 'Rename', icon: Pencil, onSelect: onRename }]} />);

    fireEvent.keyDown(screen.getByRole('button', { name: 'Session actions' }), { key: 'Enter' });
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename' }));

    expect(onRename).toHaveBeenCalledTimes(1);
  });
});
