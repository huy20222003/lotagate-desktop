// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { describe, expect, it } from 'vitest';
import { Avatar, Button, Modal, Skeleton, Tooltip } from './ui.js';

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
    const view = render(<Avatar name="Nguyen Huy" />);
    expect(view.getAllByText('NH').length).toBeGreaterThan(0);
  });

  it('keeps initials visible until a remote avatar has loaded', () => {
    const view = render(<Avatar name="Nguyen Huy" src="https://example.test/avatar.png" />);
    const image = view.container.querySelector('img');
    if (!image) throw new Error('Avatar image was not rendered.');
    expect(view.getAllByText('NH').length).toBeGreaterThan(0);
    expect(image).not.toHaveClass('loaded');
    fireEvent.load(image);
    expect(image).toHaveClass('loaded');
    fireEvent.error(image);
    expect(view.getAllByText('NH').length).toBeGreaterThan(0);
  });

  it('renders reusable tooltip and skeleton content', () => {
    render(<Tooltip label="Copy response"><Skeleton>42</Skeleton></Tooltip>);
    expect(screen.getByRole('tooltip')).toHaveTextContent('Copy response');
    expect(screen.getByText('42')).toHaveClass('skeleton');
  });
});
