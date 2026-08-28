import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  class MockWebContentsView {
    readonly webContents = {
      close: vi.fn(),
      isDestroyed: vi.fn(() => false),
      loadURL: vi.fn(async () => undefined),
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
});
