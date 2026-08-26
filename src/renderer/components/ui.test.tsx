// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';
import { Avatar, Button, CopyTextButton, Label, Modal, Skeleton, TextArea, TextInput, Tooltip } from './ui.js';

describe('desktop UI primitives', () => {
  it('renders a semantic button variant and interaction', () => {
    const onClick = () => undefined;
    render(<Button variant="primary" onClick={onClick}>Send</Button>);
    const button = screen.getByRole('button', { name: 'Send' });
    expect(button.className).toContain('button-primary');
    fireEvent.click(button);
  });

  it('renders required markers and inline input errors through shared controls', () => {
    render(<><Label required>Name</Label><TextInput label="Email" required errorText="Email is required." /><TextArea label="Notes" errorText="Notes are too long." /></>);
    expect(screen.getAllByText('*')).toHaveLength(2);
    expect(screen.getByRole('textbox', { name: 'Email' })).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('textbox', { name: 'Email' })).toHaveAccessibleDescription('Email is required.');
    expect(screen.getByRole('textbox', { name: 'Notes' })).toHaveAccessibleDescription('Notes are too long.');
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

  it('copies text through the shared clipboard action', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    render(<CopyTextButton content="response text" label="Copy response" />);

    fireEvent.click(screen.getByRole('button', { name: 'Copy response' }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith('response text'));
    expect(screen.getAllByRole('tooltip').some(tooltip => tooltip.textContent === 'Copied')).toBe(true);
  });

  it('falls back to the document copy command when clipboard API fails', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('Clipboard denied'));
    const execCommand = vi.fn().mockReturnValue(true);
    Object.defineProperty(document, 'execCommand', { configurable: true, value: execCommand });
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    render(<CopyTextButton content="user message" label="Copy message" />);

    fireEvent.click(screen.getByRole('button', { name: 'Copy message' }));

    await waitFor(() => expect(execCommand).toHaveBeenCalledWith('copy'));
    expect(screen.getAllByRole('tooltip').some(tooltip => tooltip.textContent === 'Copied')).toBe(true);
    delete (document as { execCommand?: unknown }).execCommand;
  });
});
