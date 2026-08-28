// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { StrictMode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BrowserSessionSnapshot } from '../../../contracts/ipc/v1/workspace.js';
import { BrowserPanel } from './BrowserPanel.js';

const session: BrowserSessionSnapshot = { id: 'browser-1', activeTabId: 'tab-1', createdAt: new Date().toISOString(), tabs: [{ id: 'tab-1', title: 'New tab', url: 'about:blank', loading: false, canGoBack: false, canGoForward: false }] };

describe('BrowserPanel', () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it('creates a session, mounts the native view host, and navigates from the address bar', async () => {
    const onState = vi.fn(() => vi.fn());
    const navigate = vi.fn().mockResolvedValue({ ...session.tabs[0], url: 'https://example.com/' });
    const setViewBounds = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window, 'ResizeObserver', { configurable: true, value: class { observe() {} disconnect() {} } });
    const hide = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window, 'lotagate', { configurable: true, value: { approvals: { request: vi.fn().mockResolvedValue({ approvalId: 'approval-1', approved: true }) }, browser: { create: vi.fn().mockResolvedValue(session), close: vi.fn().mockResolvedValue(undefined), hide, onState, navigate, setViewBounds, createTab: vi.fn(), closeTab: vi.fn(), selectTab: vi.fn(), goBack: vi.fn(), goForward: vi.fn(), reload: vi.fn() } } });
    render(<BrowserPanel onClose={vi.fn()} />);
    expect(await screen.findByRole('tab', { name: /New tab/u })).toBeVisible();
    await waitFor(() => expect(setViewBounds).toHaveBeenCalled());
    const address = screen.getByRole('textbox', { name: 'Browser address' });
    fireEvent.change(address, { target: { value: 'example.com' } });
    fireEvent.submit(address.closest('form')!);
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('browser-1', 'tab-1', 'https://example.com', true));
    expect(document.querySelector('.browser-view-host')).toBeInTheDocument();
  });

  it('hides the native browser view when the panel is closed', async () => {
    const onState = vi.fn(() => vi.fn());
    const hide = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    Object.defineProperty(window, 'ResizeObserver', { configurable: true, value: class { observe() {} disconnect() {} } });
    Object.defineProperty(window, 'lotagate', { configurable: true, value: { approvals: { request: vi.fn() }, browser: { create: vi.fn().mockResolvedValue(session), close: vi.fn().mockResolvedValue(undefined), hide, onState, setViewBounds: vi.fn().mockResolvedValue(undefined), navigate: vi.fn(), createTab: vi.fn(), closeTab: vi.fn(), selectTab: vi.fn(), goBack: vi.fn(), goForward: vi.fn(), reload: vi.fn() } } });

    render(<BrowserPanel onClose={onClose} />);
    await screen.findByRole('tab', { name: /New tab/u });
    fireEvent.click(screen.getByRole('button', { name: 'Close browser' }));

    expect(hide).toHaveBeenCalledWith('browser-1');
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('does not close an agent-owned session when StrictMode disposes a stale effect', async () => {
    const onState = vi.fn(() => vi.fn());
    const list = vi.fn().mockResolvedValue([session]);
    const close = vi.fn().mockResolvedValue(undefined);
    const setViewBounds = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window, 'ResizeObserver', { configurable: true, value: class { observe() {} disconnect() {} } });
    Object.defineProperty(window, 'lotagate', { configurable: true, value: { approvals: { request: vi.fn().mockResolvedValue({ approvalId: 'approval-1', approved: true }) }, browser: { list, close, hide: vi.fn().mockResolvedValue(undefined), onState, setViewBounds, create: vi.fn(), navigate: vi.fn(), createTab: vi.fn(), closeTab: vi.fn(), selectTab: vi.fn(), goBack: vi.fn(), goForward: vi.fn(), reload: vi.fn() } } });

    render(<StrictMode><BrowserPanel sessionId="browser-1" onClose={vi.fn()} /></StrictMode>);

    expect(await screen.findByRole('tab', { name: /New tab/u })).toBeVisible();
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
    expect(close).not.toHaveBeenCalled();
  });
});
