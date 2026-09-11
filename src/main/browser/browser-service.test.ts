import { describe, expect, it, vi } from 'vitest';
import type { BrowserSettings } from '../../contracts/ipc/v1/settings.js';

const mocks = vi.hoisted(() => {
  class MockWebContentsView {
    readonly webContents = {
      debugger: { isAttached: vi.fn(() => false), attach: vi.fn(), detach: vi.fn(), sendCommand: vi.fn(async () => ({})), on: vi.fn() },
      close: vi.fn(),
      isDestroyed: vi.fn(() => false),
      isDevToolsOpened: vi.fn(() => false),
      openDevTools: vi.fn(),
      loadURL: vi.fn(async () => undefined),
      getURL: vi.fn(() => 'about:blank'),
      getTitle: vi.fn(async () => 'Example'),
      executeJavaScript: vi.fn(async (): Promise<unknown> => ({ found: false, description: 'Not found.' })),
      on: vi.fn(),
      setWindowOpenHandler: vi.fn(),
    };
    readonly setBounds = vi.fn();
    readonly setVisible = vi.fn();
    constructor() { views.push(this); }
  }
  const views: Array<InstanceType<typeof MockWebContentsView>> = [];
  return {
    views,
    WebContentsView: MockWebContentsView,
    session: {
      fromPartition: vi.fn(() => ({
        on: vi.fn(),
        removeListener: vi.fn(),
        webRequest: { onCompleted: vi.fn(), onErrorOccurred: vi.fn() },
        setPermissionCheckHandler: vi.fn(),
        setPermissionRequestHandler: vi.fn(),
      })),
    },
  };
});

vi.mock('electron', () => ({ BrowserWindow: class {}, WebContentsView: mocks.WebContentsView, session: mocks.session }));

import { BrowserService } from './browser-service.js';
import { viewportForBounds, viewportForSettings } from './browser-service-support.js';

describe('BrowserService layout lifecycle', () => {
  it('uses the dimensions shown by each viewport profile', () => {
    const base: BrowserSettings = { viewportProfile: 'desktop', customViewport: { width: 1_280, height: 800, mobile: false, deviceScaleFactor: 1 }, downloadDirectory: '', sessionRetention: 'persistent', sessionRetentionMinutes: 60, originAllowlist: [], clearDataOnClose: false, evidenceRetentionDays: 30 };

    expect(viewportForSettings(base)).toEqual({ width: 1_280, height: 800, mobile: false, deviceScaleFactor: 1 });
    expect(viewportForSettings({ ...base, viewportProfile: 'laptop' })).toEqual({ width: 1_440, height: 900, mobile: false, deviceScaleFactor: 1 });
    expect(viewportForSettings({ ...base, viewportProfile: 'tablet' })).toEqual({ width: 1_024, height: 768, mobile: true, deviceScaleFactor: 2 });
  });

  it('fits an emulated viewport to a narrower browser drawer', () => {
    const viewport = { width: 1_280, height: 800, mobile: false, deviceScaleFactor: 1 };

    expect(viewportForBounds(viewport, { x: 400, y: 120, width: 592, height: 626 })).toEqual({ width: 592, height: 626, mobile: false, deviceScaleFactor: 1 });
    expect(viewportForBounds(viewport, { x: 0, y: 0, width: 1_440, height: 900 })).toEqual(viewport);
  });

  it('applies the configured desktop viewport instead of falling back to the drawer width', async () => {
    const settings: BrowserSettings = { viewportProfile: 'desktop', customViewport: { width: 1_280, height: 800, mobile: false, deviceScaleFactor: 1 }, downloadDirectory: '', sessionRetention: 'persistent', sessionRetentionMinutes: 60, originAllowlist: [], clearDataOnClose: false, evidenceRetentionDays: 30 };
    const service = new BrowserService(undefined, async () => settings);
    const snapshot = await service.create();
    const view = mocks.views.at(-1)!;
    const sendCommand = view.webContents.debugger.sendCommand;

    expect(sendCommand).toHaveBeenCalledWith('Emulation.setDeviceMetricsOverride', { width: 1_280, height: 800, mobile: false, deviceScaleFactor: 0 });
    await service.close(snapshot.id);
  });

  it('opens DevTools for the selected webpage view', async () => {
    const service = new BrowserService();
    const snapshot = await service.create();
    const view = mocks.views.at(-1)!;
    view.webContents.getURL = vi.fn(() => 'https://example.test/');
    await service.navigate(snapshot.id, snapshot.activeTabId, 'https://example.test/', true);

    service.openDevTools(snapshot.id, snapshot.activeTabId);

    expect(view.webContents.openDevTools).toHaveBeenCalledWith({ mode: 'detach', activate: true });
    await service.close(snapshot.id);
  });

  it('publishes a valid page favicon and ignores unsafe favicon URLs', async () => {
    const service = new BrowserService();
    const snapshot = await service.create();
    const contents = mocks.views.at(-1)!.webContents;
    const faviconHandler = (contents.on.mock.calls as unknown as Array<[string, (...args: unknown[]) => void]>).find(([eventName]) => eventName === 'page-favicon-updated')?.[1];

    faviconHandler?.({}, ['https://example.test/favicon.ico']);
    expect(service.get(snapshot.id).tabs[0]?.favicon).toBe('https://example.test/favicon.ico');
    faviconHandler?.({}, ['javascript:alert(1)']);
    expect(service.get(snapshot.id).tabs[0]?.favicon).toBeUndefined();
    await service.close(snapshot.id);
  });

  it('reuses a stable profile partition for the same workspace', async () => {
    mocks.session.fromPartition.mockClear();
    const settings: BrowserSettings = { viewportProfile: 'desktop', customViewport: { width: 1_280, height: 800, mobile: false, deviceScaleFactor: 1 }, downloadDirectory: '', sessionRetention: 'persistent', sessionRetentionMinutes: 60, originAllowlist: [], clearDataOnClose: false, evidenceRetentionDays: 30 };
    const service = new BrowserService(undefined, async () => settings);
    const first = await service.create('C:\\workspace-a');
    const second = await service.create('C:\\workspace-a');

    const partitions = mocks.session.fromPartition.mock.calls as unknown as Array<[string]>;
    expect(partitions[0]?.[0]).toBe(partitions[1]?.[0]);
    expect(partitions[0]?.[0]).toMatch(/^persist:lotagate-browser-/u);
    await service.close(first.id);
    await service.close(second.id);
  });

  it('ignores stale bounds updates after a browser session is closed', async () => {
    const service = new BrowserService();
    const snapshot = await service.create();

    await service.close(snapshot.id);

    expect(() => service.setViewBounds(snapshot.id, snapshot.activeTabId, { x: 0, y: 0, width: 100, height: 100 }, true)).not.toThrow();
  });

  it('hides every native tab view without closing the agent browser session', async () => {
    const service = new BrowserService();
    const snapshot = await service.create();
    const view = mocks.views.at(-1)!;

    service.hide(snapshot.id);

    expect(view.setVisible).toHaveBeenLastCalledWith(false);
    expect(view.setBounds).toHaveBeenLastCalledWith({ x: 0, y: 0, width: 0, height: 0 });
    expect(service.get(snapshot.id).id).toBe(snapshot.id);
    await service.close(snapshot.id);
  });

  it('returns a bounded element inspection for the agent', async () => {
    const service = new BrowserService();
    const snapshot = await service.create();
    mocks.views.at(-1)!.webContents.executeJavaScript.mockResolvedValueOnce({ found: true, description: 'Inspected button.', tag: 'button', name: 'Submit', computedStyle: { display: 'block' }, outerHTML: '<button>Submit</button>' });

    const inspection = await service.inspectElement(snapshot.id, snapshot.activeTabId, { type: 'css', selector: '#submit' });

    expect(inspection.found).toBe(true);
    expect(inspection.computedStyle?.['display']).toBe('block');
    await service.close(snapshot.id);
  });

  it('passes the requested interaction action into the page script', async () => {
    const service = new BrowserService();
    const snapshot = await service.create();
    const contents = mocks.views.at(-1)!.webContents;

    await service.click(snapshot.id, snapshot.activeTabId, { type: 'css', selector: '#submit' });

    const calls = contents.executeJavaScript.mock.calls as unknown[][];
    const script = calls.at(-1)?.[0];
    expect(typeof script).toBe('string');
    expect(script as string).toContain('const action = "click";');
    await service.close(snapshot.id);
  });

  it('removes the session download listener when the browser session closes', async () => {
    const service = new BrowserService();
    const snapshot = await service.create();
    const browserSession = mocks.session.fromPartition.mock.results.at(-1)?.value as { on: ReturnType<typeof vi.fn>; removeListener: ReturnType<typeof vi.fn> };
    const listener = browserSession.on.mock.calls.find((call: unknown[]) => call[0] === 'will-download')?.[1];

    await service.close(snapshot.id);

    expect(listener).toEqual(expect.any(Function));
    expect(browserSession.removeListener).toHaveBeenCalledWith('will-download', listener);
  });
});
