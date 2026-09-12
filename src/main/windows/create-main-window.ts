import { app, BrowserWindow, shell } from 'electron';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { desktopAssetPath } from '../app-assets.js';
import { configureWindowsTaskbar } from './windows-app-identity.js';

export function createMainWindow(): BrowserWindow {
  const appRoot = app.getAppPath();
  const mainDirectory = join(appRoot, '.vite', 'build');
  const preload = join(mainDirectory, 'bridge.js');
  const rendererUrl = app.isPackaged ? undefined : process.env['ELECTRON_RENDERER_URL'];
  const icon = desktopAssetPath('lotagate.ico');
  const renderer = app.isPackaged ? join(appRoot, '.vite', 'renderer', 'main_window', 'index.html') : join(appRoot, 'src', 'renderer', 'index.html');
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#10151c',
    icon,
    title: 'LotaGate Desktop',
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  configureWindowsTaskbar(window, icon);
  window.webContents.on('will-navigate', (event, destination) => {
    if (!isExpectedRendererUrl(destination, rendererUrl, renderer)) event.preventDefault();
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isHttpUrl(url)) void shell.openExternal(url).catch(() => undefined);
    return { action: 'deny' };
  });
  window.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    console.error(`[renderer-load] ${errorCode} ${errorDescription}: ${validatedURL}`);
  });
  if (rendererUrl !== undefined) {
    void window.loadURL(rendererUrl).catch(error => console.error('[renderer-load]', error));
  } else {
    void window.loadFile(renderer).catch(error => console.error('[renderer-load]', error));
  }
  return window;
}

function isExpectedRendererUrl(destination: string, developmentUrl: string | undefined, rendererFile: string): boolean {
  if (developmentUrl !== undefined) {
    try {
      const expected = new URL(developmentUrl);
      const actual = new URL(destination);
      return actual.origin === expected.origin && actual.pathname === expected.pathname;
    } catch { return false; }
  }
  try { return fileURLToPath(new URL(destination)) === rendererFile; }
  catch { return false; }
}

function isHttpUrl(value: string): boolean {
  try { const protocol = new URL(value).protocol; return protocol === 'http:' || protocol === 'https:'; }
  catch { return false; }
}
