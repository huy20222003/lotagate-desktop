import { app, BrowserWindow } from 'electron';
import { join } from 'node:path';

export function createMainWindow(): BrowserWindow {
  const appRoot = app.getAppPath();
  const mainDirectory = app.isPackaged ? join(appRoot, '.vite', 'build') : join(appRoot, 'src', 'main');
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#10151c',
    webPreferences: {
      preload: app.isPackaged ? join(mainDirectory, 'bridge.js') : join(mainDirectory, '..', 'preload', 'bridge.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  if (process.env['ELECTRON_RENDERER_URL']) {
    void window.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    const renderer = app.isPackaged ? join(appRoot, '.vite', 'renderer', 'main_window', 'index.html') : join(appRoot, 'src', 'renderer', 'index.html');
    void window.loadFile(renderer);
  }
  return window;
}
