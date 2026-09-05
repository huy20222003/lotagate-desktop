import { app, Menu, nativeImage, Tray, BrowserWindow, shell } from 'electron';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { DESKTOP_PRODUCT_NAME } from '../app-identity.js';
import { desktopAssetPath } from '../app-assets.js';
import { DesktopNotificationService, type DesktopNotificationInput } from '../notifications/desktop-notification-service.js';

export class DesktopOperations {
  private tray: Tray | undefined;

  constructor(private readonly notifications = new DesktopNotificationService()) {}

  initializeDeepLinks(): void {
    if (process.platform !== 'linux' || app.isPackaged) app.setAsDefaultProtocolClient('lotagate');
    app.on('open-url', (event, url) => { event.preventDefault(); this.emitDeepLink(url); });
  }

  initializeTray(): void {
    const iconPath = desktopAssetPath('lotagate.ico');
    const image = nativeImage.createFromPath(iconPath);
    if (image.isEmpty()) return;
    this.tray = new Tray(image);
    this.tray.setToolTip(DESKTOP_PRODUCT_NAME);
    this.tray.setContextMenu(Menu.buildFromTemplate([{ label: `Show ${DESKTOP_PRODUCT_NAME}`, click: () => this.showWindow() }, { type: 'separator' }, { label: 'Quit', click: () => app.quit() }]));
    this.tray.on('click', () => this.showWindow());
  }

  notify(title: string, body: string): void { this.notifications.notify({ title, body } satisfies DesktopNotificationInput); }
  showWindow(): void { const window = BrowserWindow.getAllWindows()[0]; if (window === undefined) return; if (window.isMinimized()) window.restore(); window.show(); window.focus(); }
  async revealPath(input: string): Promise<void> {
    if (!isAbsolute(input)) throw new Error('The file path must be absolute.');
    const path = resolve(input);
    const details = await stat(path);
    if (!details.isFile()) throw new Error('The selected path is not a file.');
    shell.showItemInFolder(path);
  }
  emitDeepLink(url: string): void { for (const window of BrowserWindow.getAllWindows()) window.webContents.send('operations.deepLink', url); }
  async exportDiagnostics(input: { version: string; settings: Record<string, unknown> }): Promise<string> { const directory = join(app.getPath('downloads'), 'lotagate-diagnostics'); await mkdir(directory, { recursive: true }); const path = join(directory, `diagnostics-${Date.now()}.json`); await writeFile(path, JSON.stringify({ appVersion: input.version, platform: process.platform, arch: process.arch, createdAt: new Date().toISOString(), settings: input.settings }, null, 2), 'utf8'); return path; }
}
