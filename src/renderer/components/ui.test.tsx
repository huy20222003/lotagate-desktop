// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';
import { Avatar, Button, Checkbox, CopyTextButton, Dropdown, Label, Modal, Skeleton, Tabs, TextArea, TextInput, Tooltip } from './ui.js';

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

  it('preserves controlled checkbox, dropdown, and tabs contracts', async () => {
    const onCheckedChange = vi.fn();
    const onDropdownChange = vi.fn();
    const onTabChange = vi.fn();
    render(<><Checkbox label="Enable feature" checked={false} onChange={onCheckedChange} /><Dropdown value="one" options={[{ value: 'one', label: 'One' }, { value: 'two', label: 'Two' }]} onChange={onDropdownChange} /><Tabs value="first" items={[{ value: 'first', label: 'First' }, { value: 'second', label: 'Second' }]} onChange={onTabChange} /></>);

    fireEvent.click(screen.getByRole('checkbox', { name: 'Enable feature' }));
    expect(onCheckedChange).toHaveBeenCalledWith(true);
    const dropdownTrigger = screen.getByRole('button', { name: 'Select option' });
    fireEvent.keyDown(dropdownTrigger, { key: 'Enter' });
    await waitFor(() => expect(dropdownTrigger).toHaveAttribute('aria-expanded', 'true'));
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Two' }));
    expect(onDropdownChange).toHaveBeenCalledWith('two');
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Second' }));
    expect(onTabChange).toHaveBeenCalledWith('second');
  });

  it('keeps modal close action explicit', () => {
    const onClose = vi.fn();
    render(<Modal title="Confirm" onClose={onClose}>Body</Modal>);
    expect(screen.getByRole('dialog', { name: 'Confirm' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Close' })).toBeEnabled();
    fireEvent.mouseDown(document.body);
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not steal focus when a modal parent rerenders', () => {
    const view = render(<Modal title="Confirm" onClose={() => undefined}><TextInput autoFocus label="Name" /><Button>Continue</Button></Modal>);
    const continueButton = screen.getByRole('button', { name: 'Continue' });
    continueButton.focus();
    view.rerender(<Modal title="Confirm" onClose={() => undefined}><TextInput autoFocus label="Name" /><Button>Continue</Button></Modal>);
    expect(document.activeElement).toBe(continueButton);
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
    expect(screen.getByText('42')).toHaveClass('skeleton');
    fireEvent.pointerMove(screen.getByText('42'), { pointerType: 'mouse' });
    return waitFor(() => expect(screen.getByRole('tooltip')).toHaveTextContent('Copy response'));
  });

  it('copies text through the shared clipboard action', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    render(<CopyTextButton content="response text" label="Copy response" />);

    fireEvent.click(screen.getByRole('button', { name: 'Copy response' }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith('response text'));
    fireEvent.pointerMove(screen.getByRole('button', { name: 'Copy response' }), { pointerType: 'mouse' });
    await waitFor(() => expect(screen.getByRole('tooltip')).toHaveTextContent('Copied'));
  });

  it('falls back to the document copy command when clipboard API fails', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('Clipboard denied'));
    const execCommand = vi.fn().mockReturnValue(true);
    Object.defineProperty(document, 'execCommand', { configurable: true, value: execCommand });
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    render(<CopyTextButton content="user message" label="Copy message" />);

    fireEvent.click(screen.getByRole('button', { name: 'Copy message' }));

    await waitFor(() => expect(execCommand).toHaveBeenCalledWith('copy'));
    fireEvent.pointerMove(screen.getByRole('button', { name: 'Copy message' }), { pointerType: 'mouse' });
    await waitFor(() => expect(screen.getByRole('tooltip')).toHaveTextContent('Copied'));
    delete (document as { execCommand?: unknown }).execCommand;
  });
});
