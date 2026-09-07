import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  app: { isPackaged: true, setName: vi.fn(), setAppUserModelId: vi.fn(), setToastActivatorCLSID: vi.fn(), getPath: vi.fn(() => 'C:\\Users\\Test\\AppData\\Roaming') },
  setAppDetails: vi.fn(),
  setIcon: vi.fn(),
  writeShortcutLink: vi.fn(() => true),
  mkdir: vi.fn(async () => undefined),
}));

vi.mock('electron', () => ({
  app: mocks.app,
  shell: { writeShortcutLink: mocks.writeShortcutLink },
}));
vi.mock('node:fs/promises', () => ({ mkdir: mocks.mkdir }));

import { configureWindowsAppIdentity, configureWindowsTaskbar } from './windows-app-identity.js';

describe.skipIf(process.platform !== 'win32')('Windows app identity', () => {
  it('sets the branded app identity during development as well as packaging', () => {
    mocks.app.isPackaged = false;

    configureWindowsAppIdentity();

    expect(mocks.app.setName).toHaveBeenCalledWith('LotaGate Desktop');
    expect(mocks.app.setAppUserModelId).toHaveBeenCalledWith('com.lotagate.desktop');
    expect(mocks.app.setToastActivatorCLSID).toHaveBeenCalledWith('{2D9DB0B0-2BDA-4E37-9D3F-0D13CFB5B5CF}');
    mocks.app.isPackaged = true;
    mocks.app.setName.mockClear();
    mocks.app.setAppUserModelId.mockClear();
  });

  it('leaves development taskbar identity to BrowserWindow icon handling', () => {
    mocks.app.isPackaged = false;
    const window = { setAppDetails: mocks.setAppDetails, setIcon: mocks.setIcon };

    configureWindowsTaskbar(window as never, 'D:\\icons\\lotagate.ico');

    expect(mocks.setIcon).toHaveBeenCalledWith('D:\\icons\\lotagate.ico');
    expect(mocks.setAppDetails).not.toHaveBeenCalled();
    mocks.app.isPackaged = true;
  });

  it('creates a development Start Menu shortcut with the notification identity', async () => {
    mocks.app.isPackaged = false;

    const { configureWindowsDevelopmentShortcut } = await import('./windows-app-identity.js');
    await configureWindowsDevelopmentShortcut('D:\\icons\\lotagate.ico');

    expect(mocks.writeShortcutLink).toHaveBeenCalledWith(
      'C:\\Users\\Test\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\LotaGate Desktop (Development).lnk',
      'replace',
      expect.objectContaining({
        target: process.execPath,
        icon: 'D:\\icons\\lotagate.ico',
        appUserModelId: 'com.lotagate.desktop',
        toastActivatorClsid: '{2D9DB0B0-2BDA-4E37-9D3F-0D13CFB5B5CF}',
      }),
    );
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
