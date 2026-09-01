import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  app: { isPackaged: true },
  setAppDetails: vi.fn(),
  setIcon: vi.fn(),
}));

vi.mock('electron', () => ({
  app: mocks.app,
}));

import { configureWindowsTaskbar } from './windows-app-identity.js';

describe('Windows app identity', () => {
  it('leaves development taskbar identity to BrowserWindow icon handling', () => {
    mocks.app.isPackaged = false;
    const window = { setAppDetails: mocks.setAppDetails, setIcon: mocks.setIcon };

    configureWindowsTaskbar(window as never, 'D:\\icons\\lotagate.ico');

    expect(mocks.setIcon).toHaveBeenCalledWith('D:\\icons\\lotagate.ico');
    expect(mocks.setAppDetails).not.toHaveBeenCalled();
    mocks.app.isPackaged = true;
  });

  it('configures the branded taskbar identity and relaunch metadata', () => {
    const window = { setAppDetails: mocks.setAppDetails, setIcon: mocks.setIcon };

    configureWindowsTaskbar(window as never, 'D:\\icons\\lotagate.ico');

    expect(mocks.setIcon).toHaveBeenCalledWith('D:\\icons\\lotagate.ico');
    expect(mocks.setAppDetails).toHaveBeenCalledWith({
      appId: 'com.lotagate.desktop',
      appIconPath: 'D:\\icons\\lotagate.ico',
      appIconIndex: 0,
      relaunchCommand: process.execPath,
      relaunchDisplayName: 'LotaGate Desktop',
    });
  });
});
