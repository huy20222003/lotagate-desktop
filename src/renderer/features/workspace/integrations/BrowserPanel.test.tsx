// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { StrictMode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BrowserSessionSnapshot } from '../../../../contracts/ipc/v1/workspace.js';
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
    expect(document.querySelector('.browser-panel-content')).toBeInTheDocument();
    expect(document.querySelector('.browser-view-host')).toBeInTheDocument();
  });

  it('anchors the native browser view to the drawer content slot', async () => {
    const onState = vi.fn(() => vi.fn());
    const setViewBounds = vi.fn().mockResolvedValue(undefined);
    const getBoundingClientRect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.classList.contains('browser-panel')) return { x: 500, y: 40, top: 40, left: 500, right: 900, bottom: 800, width: 400, height: 760, toJSON: () => ({}) };
      if (this.classList.contains('browser-toolbar')) return { x: 450, y: 40, top: 40, left: 450, right: 900, bottom: 100, width: 450, height: 60, toJSON: () => ({}) };
      if (this.classList.contains('browser-panel-content')) return { x: 560, y: 100, top: 100, left: 560, right: 700, bottom: 800, width: 140, height: 700, toJSON: () => ({}) };
      if (this.classList.contains('browser-view-host')) return { x: 560, y: 100, top: 100, left: 560, right: 700, bottom: 700, width: 140, height: 600, toJSON: () => ({}) };
      return { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) };
    });
    Object.defineProperty(window, 'ResizeObserver', { configurable: true, value: class { observe() {} disconnect() {} } });
    Object.defineProperty(window, 'lotagate', { configurable: true, value: { approvals: { request: vi.fn().mockResolvedValue({ approvalId: 'approval-1', approved: true }) }, browser: { create: vi.fn().mockResolvedValue(session), close: vi.fn().mockResolvedValue(undefined), hide: vi.fn().mockResolvedValue(undefined), onState, setViewBounds, navigate: vi.fn(), createTab: vi.fn(), closeTab: vi.fn(), selectTab: vi.fn(), goBack: vi.fn(), goForward: vi.fn(), reload: vi.fn() } } });

    render(<BrowserPanel onClose={vi.fn()} />);
    await screen.findByRole('tab', { name: /New tab/u });
    await waitFor(() => expect(setViewBounds).toHaveBeenCalledWith('browser-1', 'tab-1', { x: 450, y: 100, width: 450, height: 700 }, true));
    getBoundingClientRect.mockRestore();
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

  it('applies panel width according to configured viewport profile in settings', async () => {
    const onState = vi.fn(() => vi.fn());
    const setViewBounds = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window, 'ResizeObserver', { configurable: true, value: class { observe() {} disconnect() {} } });
    Object.defineProperty(window, 'lotagate', { configurable: true, value: {
      settings: { get: vi.fn().mockResolvedValue({ browser: { viewportProfile: 'tablet' } }) },
      approvals: { request: vi.fn().mockResolvedValue({ approvalId: 'approval-1', approved: true }) },
      browser: { create: vi.fn().mockResolvedValue(session), close: vi.fn().mockResolvedValue(undefined), hide: vi.fn().mockResolvedValue(undefined), onState, setViewBounds, navigate: vi.fn(), createTab: vi.fn(), closeTab: vi.fn(), selectTab: vi.fn(), goBack: vi.fn(), goForward: vi.fn(), reload: vi.fn() },
    } });

    Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: 2000 });
    render(<BrowserPanel onClose={vi.fn()} />);
    const panel = await screen.findByRole('complementary', { name: 'Browser' });
    await waitFor(() => {
      expect(panel).toHaveStyle({ width: '1000px' });
    });
  });

  it('clamps panel width to 50vw max viewport ratio', async () => {
    const onState = vi.fn(() => vi.fn());
    const setViewBounds = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window, 'ResizeObserver', { configurable: true, value: class { observe() {} disconnect() {} } });
    Object.defineProperty(window, 'lotagate', { configurable: true, value: {
      settings: { get: vi.fn().mockResolvedValue({ browser: { viewportProfile: 'desktop' } }) },
      approvals: { request: vi.fn().mockResolvedValue({ approvalId: 'approval-1', approved: true }) },
      browser: { create: vi.fn().mockResolvedValue(session), close: vi.fn().mockResolvedValue(undefined), hide: vi.fn().mockResolvedValue(undefined), onState, setViewBounds, navigate: vi.fn(), createTab: vi.fn(), closeTab: vi.fn(), selectTab: vi.fn(), goBack: vi.fn(), goForward: vi.fn(), reload: vi.fn() },
    } });

    Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: 1000 });
    render(<BrowserPanel onClose={vi.fn()} />);
    const panel = await screen.findByRole('complementary', { name: 'Browser' });
    // 1000 * 0.5 = 500px max width for desktop profile (1280px)
    await waitFor(() => {
      expect(panel).toHaveStyle({ width: '500px' });
    });
  });
});
