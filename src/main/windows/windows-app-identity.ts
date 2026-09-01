import { app, type BrowserWindow } from 'electron';
import { DESKTOP_APP_USER_MODEL_ID, DESKTOP_PRODUCT_NAME, DESKTOP_TOAST_ACTIVATOR_CLSID } from '../app-identity.js';

export function configureWindowsAppIdentity(): void {
  if (process.platform !== 'win32' || !app.isPackaged) return;
  app.setName(DESKTOP_PRODUCT_NAME);
  app.setAppUserModelId(DESKTOP_APP_USER_MODEL_ID);
  app.setToastActivatorCLSID(DESKTOP_TOAST_ACTIVATOR_CLSID);
}

export function configureWindowsTaskbar(window: BrowserWindow, iconPath: string): void {
  if (process.platform !== 'win32') return;
  window.setIcon(iconPath);
  if (!app.isPackaged) return;
  window.setAppDetails({
    appId: DESKTOP_APP_USER_MODEL_ID,
    appIconPath: iconPath,
    appIconIndex: 0,
    relaunchCommand: process.execPath,
    relaunchDisplayName: DESKTOP_PRODUCT_NAME,
  });
}
