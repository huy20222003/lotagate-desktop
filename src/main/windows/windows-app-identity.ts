import { app, shell, type BrowserWindow } from 'electron';
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { DESKTOP_APP_USER_MODEL_ID, DESKTOP_PRODUCT_NAME, DESKTOP_TOAST_ACTIVATOR_CLSID } from '../app-identity.js';

export function configureWindowsAppIdentity(): void {
  if (process.platform !== 'win32') return;
  app.setName(DESKTOP_PRODUCT_NAME);
  app.setAppUserModelId(DESKTOP_APP_USER_MODEL_ID);
  app.setToastActivatorCLSID(DESKTOP_TOAST_ACTIVATOR_CLSID);
}

/** Registers the dev Electron process under the same Windows identity as the packaged app. */
export async function configureWindowsDevelopmentShortcut(iconPath: string): Promise<void> {
  if (process.platform !== 'win32' || app.isPackaged) return;
  const shortcutPath = join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', `${DESKTOP_PRODUCT_NAME} (Development).lnk`);
  await mkdir(dirname(shortcutPath), { recursive: true });
  const created = shell.writeShortcutLink(shortcutPath, 'replace', {
    target: process.execPath,
    args: quoteWindowsArgument(process.cwd()),
    cwd: process.cwd(),
    description: DESKTOP_PRODUCT_NAME,
    icon: iconPath,
    iconIndex: 0,
    appUserModelId: DESKTOP_APP_USER_MODEL_ID,
    toastActivatorClsid: DESKTOP_TOAST_ACTIVATOR_CLSID,
  });
  if (!created) throw new Error('Windows rejected the development notification shortcut.');
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

function quoteWindowsArgument(value: string): string {
  return `"${value.replace(/(\\*)"/gu, '$1$1\\"').replace(/(\\+)$/u, '$1$1')}"`;
}
