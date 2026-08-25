import { app, Menu, nativeImage, Notification, Tray, BrowserWindow, net } from 'electron';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export class DesktopOperations {
  private tray: Tray | undefined;

  initializeDeepLinks(): void {
    if (process.platform !== 'linux' || app.isPackaged) app.setAsDefaultProtocolClient('lotagate');
    app.on('open-url', (event, url) => { event.preventDefault(); this.emitDeepLink(url); });
  }

  initializeTray(): void {
    const iconPath = join(app.getAppPath(), 'resources', 'icons', 'lotagate.ico');
    const image = nativeImage.createFromPath(iconPath);
    if (image.isEmpty()) return;
    this.tray = new Tray(image);
    this.tray.setToolTip('LotaGate Agent Workspace');
    this.tray.setContextMenu(Menu.buildFromTemplate([{ label: 'Show LotaGate', click: () => this.showWindow() }, { type: 'separator' }, { label: 'Quit', click: () => app.quit() }]));
    this.tray.on('click', () => this.showWindow());
  }

  notify(title: string, body: string): void { if (Notification.isSupported()) new Notification({ title, body }).show(); }
  showWindow(): void { const window = BrowserWindow.getAllWindows()[0]; if (window === undefined) return; if (window.isMinimized()) window.restore(); window.show(); window.focus(); }
  async checkForUpdates(manifestUrl: string): Promise<Record<string, string> | null> {
    if (!manifestUrl) return null;
    const parsed = new URL(manifestUrl);
    if (parsed.protocol !== 'https:') throw new Error('Update manifests must use HTTPS.');
    const response = await net.fetch(parsed.toString());
    if (!response.ok) throw new Error(`Update manifest request failed (${response.status}).`);
    const value: unknown = await response.json();
    if (typeof value !== 'object' || value === null) throw new Error('Update manifest is invalid.');
    const record = value as Record<string, unknown>;
    if (typeof record['version'] !== 'string' || typeof record['url'] !== 'string') throw new Error('Update manifest is invalid.');
    return { version: record['version'], url: record['url'], ...(typeof record['notes'] === 'string' ? { notes: record['notes'] } : {}) };
  }
  emitDeepLink(url: string): void { for (const window of BrowserWindow.getAllWindows()) window.webContents.send('operations.deepLink', url); }
  async exportDiagnostics(input: { version: string; settings: Record<string, unknown> }): Promise<string> { const directory = join(app.getPath('downloads'), 'lotagate-diagnostics'); await mkdir(directory, { recursive: true }); const path = join(directory, `diagnostics-${Date.now()}.json`); await writeFile(path, JSON.stringify({ appVersion: input.version, platform: process.platform, arch: process.arch, createdAt: new Date().toISOString(), settings: input.settings }, null, 2), 'utf8'); return path; }
}
