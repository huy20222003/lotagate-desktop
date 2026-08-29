// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OrchestrationDrawer } from './OrchestrationDrawer.js';

describe('OrchestrationDrawer', () => {
  afterEach(() => cleanup());

  it('closes when the pointer lands outside the drawer', () => {
    const onClose = vi.fn();
    render(<OrchestrationDrawer title="Plan" onClose={onClose}>Details</OrchestrationDrawer>);

    fireEvent.pointerDown(document.body);

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes with Escape while keeping the close button available', () => {
    const onClose = vi.fn();
    render(<OrchestrationDrawer title="Plan" onClose={onClose}>Details</OrchestrationDrawer>);

    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: 'Close orchestration details' }));

    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
