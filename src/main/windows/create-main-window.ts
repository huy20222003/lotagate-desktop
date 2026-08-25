import { app, BrowserWindow } from 'electron';
import { join } from 'node:path';

export function createMainWindow(): BrowserWindow {
  const appRoot = app.getAppPath();
  const mainDirectory = join(appRoot, '.vite', 'build');
  const preload = join(mainDirectory, 'bridge.js');
  const rendererUrl = process.env['ELECTRON_RENDERER_URL'];
  const icon = join(app.getAppPath(), 'resources', 'icons', 'lotagate.ico');
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#10151c',
    icon,
    title: 'LotaGate Agent Workspace',
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  window.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    console.error(`[renderer-load] ${errorCode} ${errorDescription}: ${validatedURL}`);
  });
  if (rendererUrl !== undefined) {
    void window.loadURL(rendererUrl).catch(error => console.error('[renderer-load]', error));
  } else {
    const renderer = app.isPackaged ? join(appRoot, '.vite', 'renderer', 'main_window', 'index.html') : join(appRoot, 'src', 'renderer', 'index.html');
    void window.loadFile(renderer).catch(error => console.error('[renderer-load]', error));
  }
  return window;
}
