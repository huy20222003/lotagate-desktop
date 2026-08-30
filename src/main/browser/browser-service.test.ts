import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  class MockWebContentsView {
    readonly webContents = {
      debugger: { isAttached: vi.fn(() => false), attach: vi.fn(), detach: vi.fn(), sendCommand: vi.fn(async () => ({})), on: vi.fn() },
      close: vi.fn(),
      isDestroyed: vi.fn(() => false),
      loadURL: vi.fn(async () => undefined),
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
        webRequest: { onCompleted: vi.fn(), onErrorOccurred: vi.fn() },
        setPermissionCheckHandler: vi.fn(),
        setPermissionRequestHandler: vi.fn(),
      })),
    },
  };
});

vi.mock('electron', () => ({ BrowserWindow: class {}, WebContentsView: mocks.WebContentsView, session: mocks.session }));

import { BrowserService } from './browser-service.js';

describe('BrowserService layout lifecycle', () => {
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
});
