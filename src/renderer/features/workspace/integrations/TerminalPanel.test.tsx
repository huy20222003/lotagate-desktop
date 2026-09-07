// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { StrictMode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TerminalSession } from '../../../../contracts/ipc/v1/workspace.js';
import { TerminalPanel } from './TerminalPanel.js';

vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { fit() {} } }));
vi.mock('@xterm/xterm', () => ({ Terminal: class {
  loadAddon() {}
  open() {}
  onData() { return { dispose() {} }; }
  onResize() { return { dispose() {} }; }
  write() {}
  dispose() {}
} }));

const session: TerminalSession = { id: 'terminal-1', cwd: 'D:\\workspace', shell: 'powershell' };

describe('TerminalPanel', () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it('opens only one automatic tab under React StrictMode', async () => {
    const open = vi.fn().mockResolvedValue(session);
    const request = vi.fn().mockResolvedValue({ approvalId: 'approval-1', approved: true });
    installTerminalBridge(open, request);

    render(<StrictMode><TerminalPanel cwd="D:\\workspace" open onClose={vi.fn()} /></StrictMode>);

    expect(await screen.findByRole('tab', { name: 'workspace' })).toBeVisible();
    await waitFor(() => expect(open).toHaveBeenCalledTimes(1));
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('keeps the existing tab when the drawer is hidden and shown again', async () => {
    const open = vi.fn().mockResolvedValue(session);
    const request = vi.fn().mockResolvedValue({ approvalId: 'approval-1', approved: true });
    const close = vi.fn().mockResolvedValue(undefined);
    installTerminalBridge(open, request, close);

    const view = render(<TerminalPanel cwd="D:\\workspace" open={false} onClose={vi.fn()} />);
    view.rerender(<TerminalPanel cwd="D:\\workspace" open onClose={vi.fn()} />);
    expect(await screen.findByRole('tab', { name: 'workspace' })).toBeVisible();

    view.rerender(<TerminalPanel cwd="D:\\workspace" open={false} onClose={vi.fn()} />);
    expect(document.querySelector('.terminal-panel')).toHaveAttribute('hidden');
    view.rerender(<TerminalPanel cwd="D:\\workspace" open onClose={vi.fn()} />);
    await waitFor(() => expect(open).toHaveBeenCalledTimes(1));
    expect(close).not.toHaveBeenCalled();
  });

  it('resizes from the top edge below and the left edge on the right', async () => {
    const open = vi.fn().mockResolvedValue(session);
    const request = vi.fn().mockResolvedValue({ approvalId: 'approval-1', approved: true });
    installTerminalBridge(open, request);

    const view = render(<TerminalPanel cwd="D:\\workspace" open placement="bottom" onClose={vi.fn()} />);
    expect(await screen.findByRole('tab', { name: 'workspace' })).toBeVisible();
    const panel = document.querySelector<HTMLElement>('.terminal-panel');
    expect(panel).not.toBeNull();
    const bottomHandle = screen.getByRole('separator', { name: 'Resize terminal height' });
    fireEvent.keyDown(bottomHandle, { key: 'ArrowUp' });
    expect(panel).toHaveStyle({ height: '336px' });

    view.rerender(<TerminalPanel cwd="D:\\workspace" open placement="right" onClose={vi.fn()} />);
    const sideHandle = screen.getByRole('separator', { name: 'Resize terminal width' });
    fireEvent.keyDown(sideHandle, { key: 'ArrowLeft' });
    expect(panel).toHaveStyle({ width: '536px' });
  });
});

function installTerminalBridge(open: ReturnType<typeof vi.fn>, request: ReturnType<typeof vi.fn>, close = vi.fn().mockResolvedValue(undefined)): void {
  Object.defineProperty(window, 'ResizeObserver', { configurable: true, value: class { observe() {} disconnect() {} } });
  Object.defineProperty(window, 'lotagate', { configurable: true, value: {
    approvals: { request },
    settings: { get: vi.fn().mockResolvedValue({ terminalFontSize: 13, terminalScrollback: 10_000, terminalCursorBlink: true }) },
    terminal: { open, close, onOutput: vi.fn(() => () => undefined), write: vi.fn(), resize: vi.fn() },
  } });
}
