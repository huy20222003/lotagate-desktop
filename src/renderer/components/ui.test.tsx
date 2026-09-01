// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Avatar, Button, Checkbox, CopyTextButton, Dropdown, IconButton, Label, Modal, Skeleton, Tabs, TextArea, TextInput, Tooltip } from './ui.js';
import { Check } from 'lucide-react';

describe('desktop UI primitives', () => {
  afterEach(cleanup);

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
    expect(document.querySelector('.dropdown-scrollbar')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Two' }));
    expect(onDropdownChange).toHaveBeenCalledWith('two');
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Second' }));
    expect(onTabChange).toHaveBeenCalledWith('second');
  });

  it('composes icon buttons with an accessible label and reusable tooltip', async () => {
    render(<IconButton icon={Check} label="Confirm" />);
    const button = screen.getByRole('button', { name: 'Confirm' });
    expect(button).toHaveClass('icon-button', 'ui-icon-button');
    fireEvent.pointerMove(button, { pointerType: 'mouse' });
    await waitFor(() => expect(screen.getByRole('tooltip')).toHaveTextContent('Confirm'));
  });

  it('supports an optional controlled multi-select dropdown', async () => {
    const onChange = vi.fn();
    render(<Dropdown multiple value={['one']} options={[{ value: 'one', label: 'One' }, { value: 'two', label: 'Two' }]} onChange={onChange} placeholder="Select values" />);

    const trigger = screen.getAllByRole('button', { name: 'Select option' }).at(-1);
    if (!trigger) throw new Error('Dropdown trigger was not rendered.');
    fireEvent.keyDown(trigger, { key: 'Enter' });
    await waitFor(() => expect(trigger).toHaveAttribute('aria-expanded', 'true'));
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Two' }));
    expect(onChange).toHaveBeenCalledWith(['one', 'two']);
  });

  it('shows an explicit empty state when a dropdown has no options', async () => {
    render(<Dropdown value="" options={[]} onChange={() => undefined} placeholder="Select model" />);
    const trigger = screen.getByRole('button', { name: 'Select option' });
    fireEvent.keyDown(trigger, { key: 'Enter' });
    await waitFor(() => expect(trigger).toHaveAttribute('aria-expanded', 'true'));
    expect(screen.getByText('No item to select')).toBeVisible();
  });

  it('closes a modal when the user clicks outside it', () => {
    const onClose = vi.fn();
    render(<Modal title="Confirm" onClose={onClose}>Body</Modal>);
    expect(screen.getByRole('dialog', { name: 'Confirm' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Close' })).toBeEnabled();
    const backdrop = document.querySelector('.modal-backdrop');
    if (!backdrop) throw new Error('Modal backdrop was not rendered.');
    fireEvent.pointerDown(backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps modal open while interacting with a portalled dropdown', () => {
    const onClose = vi.fn();
    render(<Modal title="Confirm" onClose={onClose}><div data-radix-menu-content><button type="button">Option</button></div></Modal>);
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Option' }));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes a dropdown without closing its parent modal', async () => {
    const onClose = vi.fn();
    render(<Modal title="Confirm" onClose={onClose}><div data-testid="modal-body"><Dropdown value="one" options={[{ value: 'one', label: 'One' }, { value: 'two', label: 'Two' }]} onChange={() => undefined} /></div></Modal>);
    const trigger = screen.getByRole('button', { name: 'Select option' });

    fireEvent.keyDown(trigger, { key: 'Enter' });
    await waitFor(() => expect(trigger).toHaveAttribute('aria-expanded', 'true'));
    fireEvent.pointerDown(screen.getByTestId('modal-body'));

    await waitFor(() => expect(trigger).toHaveAttribute('aria-expanded', 'false'));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'Confirm' })).toBeVisible();
  });

  it('closes a modal with Escape', () => {
    const onClose = vi.fn();
    render(<Modal title="Confirm" onClose={onClose}>Body</Modal>);
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
