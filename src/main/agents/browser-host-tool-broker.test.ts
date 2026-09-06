import { describe, expect, it, vi } from 'vitest';
import type { DesktopHostRequest } from '../../contracts/agent-protocol/v1/desktop.js';
import type { BrowserService } from '../browser/browser-service.js';
import { BrowserHostToolBroker } from './browser-host-tool-broker.js';

const browserSnapshot = { id: 'browser-1', activeTabId: 'tab-1', tabs: [] };

describe('BrowserHostToolBroker', () => {
  it('routes every browser catalog action to the Desktop browser service', async () => {
    const browser = {
      create: vi.fn().mockResolvedValue(browserSnapshot),
      get: vi.fn().mockReturnValue(browserSnapshot),
      navigate: vi.fn().mockResolvedValue({}),
      createTab: vi.fn().mockResolvedValue({}),
      closeTab: vi.fn().mockResolvedValue(undefined),
      selectTab: vi.fn().mockResolvedValue({}),
      inspect: vi.fn().mockResolvedValue({}),
      inspectElement: vi.fn().mockResolvedValue({}),
      console: vi.fn().mockReturnValue({}),
      network: vi.fn().mockReturnValue({}),
      accessibility: vi.fn().mockResolvedValue({}),
      setResponsiveViewport: vi.fn().mockResolvedValue({}),
      resetResponsiveViewport: vi.fn().mockResolvedValue({}),
      screenshot: vi.fn().mockResolvedValue({ evidenceId: 'evidence-1', path: 'screenshot.png', dataUrl: 'data:image/png;base64,iVBORw0KGgo=' }),
      click: vi.fn().mockResolvedValue({}),
      focus: vi.fn().mockResolvedValue({}),
      clear: vi.fn().mockResolvedValue({}),
      hover: vi.fn().mockResolvedValue({}),
      check: vi.fn().mockResolvedValue({}),
      selectOption: vi.fn().mockResolvedValue({}),
      readField: vi.fn().mockResolvedValue({}),
      type: vi.fn().mockResolvedValue({}),
      upload: vi.fn().mockResolvedValue({}),
      download: vi.fn().mockResolvedValue({}),
      dialog: vi.fn().mockResolvedValue({}),
      press: vi.fn().mockResolvedValue({}),
      scroll: vi.fn().mockResolvedValue({}),
      goBack: vi.fn().mockResolvedValue({}),
      goForward: vi.fn().mockResolvedValue({}),
      reload: vi.fn().mockResolvedValue({}),
      waitFor: vi.fn().mockResolvedValue({}),
    } as unknown as BrowserService;
    const broker = new BrowserHostToolBroker(browser);
    const cases: Array<[string, Record<string, unknown>]> = [
      ['browser.navigate', { url: 'https://example.test' }], ['browser.newTab', {}], ['browser.closeTab', {}], ['browser.selectTab', { tabId: 'tab-1' }],
      ['browser.inspect', {}], ['browser.inspectElement', { target: { type: 'css', selector: 'body' } }], ['browser.console', {}], ['browser.network', {}], ['browser.accessibility', {}],
      ['browser.setViewport', { width: 1280, height: 720 }], ['browser.resetViewport', {}], ['browser.screenshot', {}], ['browser.click', { target: { type: 'text', value: 'Open' } }],
      ['browser.focus', { target: { type: 'css', selector: '#name' } }], ['browser.clear', { target: { type: 'css', selector: '#name' } }], ['browser.hover', { target: { type: 'css', selector: '#menu' } }],
      ['browser.check', { target: { type: 'css', selector: '#terms' }, checked: true }], ['browser.select', { target: { type: 'css', selector: '#country' }, value: 'VN' }],
      ['browser.readField', { target: { type: 'css', selector: '#name' } }], ['browser.type', { target: { type: 'css', selector: '#name' }, value: 'LotaGate' }],
      ['browser.upload', { target: { type: 'css', selector: 'input[type=file]' }, path: 'package.json' }], ['browser.download', { url: 'https://example.test/file.txt' }],
      ['browser.dialog', { action: 'read' }], ['browser.press', { key: 'Enter' }], ['browser.scroll', { deltaY: 500 }], ['browser.back', {}], ['browser.forward', {}], ['browser.reload', {}],
      ['browser.waitFor', { condition: { type: 'text', value: 'Done' } }], ['browser.tabs', {}],
    ];
    for (const [action, params] of cases) {
      const response = await broker.handle(process.cwd(), request(action, params));
      expect(response.ok, action).toBe(true);
    }
    expect(browser.create).toHaveBeenCalledOnce();
    expect(browser.create).toHaveBeenCalledWith(`${process.cwd()}\u0000session-1`);
    expect(browser.upload).toHaveBeenCalledOnce();
    expect(browser.download).toHaveBeenCalledOnce();
    expect(browser.dialog).toHaveBeenCalledOnce();
  });

  it('forwards the PNG data URL together with browser evidence metadata', async () => {
    const browser = {
      create: vi.fn().mockResolvedValue(browserSnapshot),
      get: vi.fn().mockReturnValue(browserSnapshot),
      screenshot: vi.fn().mockResolvedValue({ evidenceId: 'evidence-1', path: 'screenshot.png', dataUrl: 'data:image/png;base64,iVBORw0KGgo=' }),
    } as unknown as BrowserService;
    const broker = new BrowserHostToolBroker(browser);

    const response = await broker.handle('C:\\workspace', request('browser.screenshot', {}));

    expect(response).toMatchObject({
      ok: true,
      result: {
        evidenceId: 'evidence-1',
        path: 'screenshot.png',
        dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
      },
    });
  });

  it('closes only the browser session belonging to an exited agent session', async () => {
    const browser = {
      create: vi.fn()
        .mockResolvedValueOnce({ id: 'browser-1', activeTabId: 'tab-1', tabs: [] })
        .mockResolvedValueOnce({ id: 'browser-2', activeTabId: 'tab-2', tabs: [] }),
      get: vi.fn().mockImplementation(id => ({ id, activeTabId: 'tab-1', tabs: [] })),
      close: vi.fn().mockResolvedValue(undefined),
    } as unknown as BrowserService;
    const broker = new BrowserHostToolBroker(browser);
    await broker.handle('C:\\workspace', request('browser.tabs', {}));
    await broker.handle('C:\\workspace', { ...request('browser.tabs', {}), requestId: 'request-2', sessionId: 'session-2' });

    await broker.closeForSession('C:\\workspace', 'session-1');

    expect(browser.close).toHaveBeenCalledOnce();
    expect(browser.close).toHaveBeenCalledWith('browser-1');
  });

  it('does not repopulate a browser session after close cancels a pending creation', async () => {
    let resolveCreate: ((snapshot: typeof browserSnapshot) => void) | undefined;
    const browser = {
      create: vi.fn(() => new Promise<typeof browserSnapshot>(resolve => { resolveCreate = resolve; })),
      close: vi.fn().mockResolvedValue(undefined),
      get: vi.fn().mockReturnValue(browserSnapshot),
    } as unknown as BrowserService;
    const broker = new BrowserHostToolBroker(browser);
    const pending = broker.handle('C:\\workspace', request('browser.tabs', {}));
    await vi.waitFor(() => expect(browser.create).toHaveBeenCalledOnce());

    await broker.closeForSession('C:\\workspace', 'session-1');
    resolveCreate?.(browserSnapshot);

    await expect(pending).resolves.toMatchObject({ ok: false, error: { code: 'BROWSER_HOST_ERROR' } });
    expect(browser.close).toHaveBeenCalledWith('browser-1');
    expect(browser.get).not.toHaveBeenCalled();
  });

  it('closes the owned browser session when an active action is cancelled', async () => {
    let resolveNavigate: (() => void) | undefined;
    const browser = {
      create: vi.fn().mockResolvedValue(browserSnapshot),
      get: vi.fn().mockReturnValue(browserSnapshot),
      navigate: vi.fn(() => new Promise<void>(resolve => { resolveNavigate = resolve; })),
      close: vi.fn().mockResolvedValue(undefined),
    } as unknown as BrowserService;
    const broker = new BrowserHostToolBroker(browser);
    const controller = new AbortController();
    const pending = broker.handle('C:\\workspace', request('browser.navigate', { url: 'https://example.test' }), controller.signal);
    await vi.waitFor(() => expect(browser.navigate).toHaveBeenCalledOnce());

    controller.abort();
    await vi.waitFor(() => expect(browser.close).toHaveBeenCalledWith('browser-1'));
    resolveNavigate?.();

    await expect(pending).resolves.toMatchObject({ ok: false, error: { code: 'BROWSER_HOST_ERROR', message: 'Browser action was cancelled.' } });
  });
});

function request(action: string, params: Record<string, unknown>): DesktopHostRequest {
  return { version: 1, type: 'host.request', requestId: `request-${action}`, tool: 'browser', sessionId: 'session-1', runId: 'run-1', action, params, executionBoundary: 'host', hostFallback: 'deny' };
}
