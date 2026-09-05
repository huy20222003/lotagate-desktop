// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Breadcrumb } from './Breadcrumb.js';

describe('Breadcrumb', () => {
  it('renders plugin detail labels and navigates parent segments', () => {
    const onNavigate = vi.fn();
    render(<Breadcrumb path="settings/plugin/workspace-review" currentHeading labels={{ 'workspace-review': 'workspace-review' }} onNavigate={onNavigate} />);

    expect(screen.getByRole('heading', { name: 'workspace-review' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    fireEvent.click(screen.getByRole('button', { name: 'Plugins' }));

    expect(onNavigate).toHaveBeenNthCalledWith(1, 'settings');
    expect(onNavigate).toHaveBeenNthCalledWith(2, 'settings/plugin');
  });
});
