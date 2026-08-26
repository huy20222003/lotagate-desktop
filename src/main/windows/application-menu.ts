import { BrowserWindow, Menu, type MenuItemConstructorOptions } from 'electron';

export type DesktopMenuCommand = 'newTask' | 'openWorkspace';
export type DesktopMenuContext = 'login' | 'workspace';

export function setApplicationMenu(context: DesktopMenuContext): void {
  if (context === 'login') {
    Menu.setApplicationMenu(null);
    return;
  }
  const sendCommand = (command: DesktopMenuCommand) => {
    BrowserWindow.getFocusedWindow()?.webContents.send('menu.command', command);
  };
  const template: MenuItemConstructorOptions[] = [
    {
      label: 'File',
      submenu: [
        { label: 'New Chat', click: () => sendCommand('newTask') },
        { label: 'Open Workspace...', accelerator: 'CmdOrCtrl+O', click: () => sendCommand('openWorkspace') },
        { type: 'separator' },
        { role: 'quit', label: 'Exit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }],
    },
    {
      label: 'View',
      submenu: [{ role: 'reload' }, { role: 'forceReload' }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'togglefullscreen' }],
    },
    {
      label: 'Window',
      submenu: [{ role: 'minimize' }, { role: 'close' }],
    },
    {
      label: 'Help',
      submenu: [{ label: 'LotaGate Desktop' }],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
