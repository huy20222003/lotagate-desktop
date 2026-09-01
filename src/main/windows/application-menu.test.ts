import { beforeEach, describe, expect, it, vi } from 'vitest';

interface TestMenuItem {
  label?: string;
  role?: string;
  submenu?: TestMenuItem[];
  click?: () => void;
}

const mocks = vi.hoisted(() => ({
  template: undefined as unknown,
  focusedWindow: { webContents: { send: vi.fn() } },
  setApplicationMenu: vi.fn(),
  showMessageBox: vi.fn(),
}));

vi.mock('electron', () => ({
  app: { getVersion: () => '0.1.0' },
  BrowserWindow: { getFocusedWindow: () => mocks.focusedWindow },
  dialog: { showMessageBox: mocks.showMessageBox },
  Menu: {
    setApplicationMenu: mocks.setApplicationMenu,
    buildFromTemplate: (template: TestMenuItem[]) => { mocks.template = template; return template; },
  },
}));

import { setApplicationMenu } from './application-menu.js';

function workspaceMenu(): TestMenuItem[] {
  if (!Array.isArray(mocks.template)) throw new Error('Workspace menu was not built.');
  return mocks.template as TestMenuItem[];
}

function submenu(menu: TestMenuItem[], label: string): TestMenuItem[] {
  const item = menu.find(entry => entry.label === label);
  if (!item?.submenu) throw new Error(`Missing ${label} submenu.`);
  return item.submenu;
}

describe('application menu', () => {
  beforeEach(() => {
    mocks.template = undefined;
    mocks.setApplicationMenu.mockReset();
    mocks.showMessageBox.mockReset();
    mocks.focusedWindow.webContents.send.mockReset();
  });

  it('removes the menu while the user is logged out', () => {
    setApplicationMenu('login');

    expect(mocks.setApplicationMenu).toHaveBeenCalledWith(null);
  });

  it('routes custom commands and provides working About and native actions', () => {
    setApplicationMenu('workspace');
    const menu = workspaceMenu();

    const file = submenu(menu, 'File');
    file.find(item => item.label === 'New Chat')?.click?.();
    file.find(item => item.label === 'Open Workspace...')?.click?.();
    expect(mocks.focusedWindow.webContents.send).toHaveBeenNthCalledWith(1, 'menu.command', 'newTask');
    expect(mocks.focusedWindow.webContents.send).toHaveBeenNthCalledWith(2, 'menu.command', 'openWorkspace');

    submenu(menu, 'Help').find(item => item.label === 'About LotaGate Desktop')?.click?.();
    expect(mocks.showMessageBox).toHaveBeenCalledWith(mocks.focusedWindow, expect.objectContaining({ message: 'LotaGate Desktop', detail: 'Version 0.1.0' }));

    expect(submenu(menu, 'Edit').map(item => item.role)).toEqual(['undo', 'redo', undefined, 'cut', 'copy', 'paste', 'selectAll']);
    expect(submenu(menu, 'View').map(item => item.role)).toEqual(['reload', 'forceReload', 'toggleDevTools', undefined, 'resetZoom', 'zoomIn', 'zoomOut', 'togglefullscreen']);
    expect(submenu(menu, 'Window').map(item => item.role)).toEqual(['minimize', 'close']);
  });
});
