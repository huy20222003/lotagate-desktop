// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { describe, expect, it } from 'vitest';
import { Avatar, Button, Modal } from './ui.js';

describe('desktop UI primitives', () => {
  it('renders a semantic button variant and interaction', () => {
    const onClick = () => undefined;
    render(<Button variant="primary" onClick={onClick}>Send</Button>);
    const button = screen.getByRole('button', { name: 'Send' });
    expect(button.className).toContain('button-primary');
    fireEvent.click(button);
  });

  it('keeps modal close action explicit', () => {
    const onClose = () => undefined;
    render(<Modal title="Confirm" onClose={onClose}>Body</Modal>);
    expect(screen.getByRole('dialog', { name: 'Confirm' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Close' })).toBeEnabled();
  });

  it('provides accessible fallback initials for an avatar', () => {
    render(<Avatar name="Nguyen Huy" />);
    expect(screen.getByText('NH')).toBeVisible();
  });
});
