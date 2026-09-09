import { app, Menu, nativeImage, Tray, BrowserWindow, shell } from 'electron';
import { spawn } from 'node:child_process';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { basename, isAbsolute, join, resolve } from 'node:path';
import { DESKTOP_PRODUCT_NAME } from '../app-identity.js';
import { desktopAssetPath } from '../app-assets.js';
import { DesktopNotificationService, type DesktopNotificationInput } from '../notifications/desktop-notification-service.js';
import { DEFAULT_FILE_OPEN_DESTINATION, type DesktopSettingsSnapshot, type FileOpenDestination } from '../../contracts/ipc/v1/settings.js';
import type { WorkspaceFileSuggestion } from '../../contracts/ipc/v1/workspace.js';
import { MAX_RESULTS } from '../workspaces/workspace-constants.js';
import { DESKTOP_RUNTIME_LIMITS } from '../../contracts/runtime-limits.js';
import type { DesktopFilePreview } from '../../contracts/ipc/v1/workspace.js';
import { artifactKind } from '../artifacts/artifact-kind.js';
import { artifactMimeType } from '../artifacts/artifact-mime.js';

export class DesktopOperations {
  private tray: Tray | undefined;

  constructor(private readonly notifications = new DesktopNotificationService(), private readonly getSettings: () => Promise<Pick<DesktopSettingsSnapshot, 'defaultFileOpenDestination'>> = async () => ({ defaultFileOpenDestination: DEFAULT_FILE_OPEN_DESTINATION })) {}

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
    await this.openFile(input, 'file-explorer');
  }
  async openFile(input: string, destination?: FileOpenDestination): Promise<void> {
    if (!isAbsolute(input)) throw new Error('The file path must be absolute.');
    const path = resolve(input);
    const details = await stat(path);
    const target = destination ?? (await this.getSettings()).defaultFileOpenDestination;
    if (details.isDirectory()) {
      if (target === 'file-explorer') { const error = await shell.openPath(path); if (error) throw new Error(error); return; }
      await openInVsCode(path);
      return;
    }
    if (!details.isFile()) throw new Error('The selected path is not a regular file or folder.');
    if (target === 'file-explorer') { shell.showItemInFolder(path); return; }
    await openInVsCode(path);
  }
  async listDirectory(input: string): Promise<WorkspaceFileSuggestion[]> {
    const directory = await requireAbsoluteDirectory(input);
    const entries = await readdir(directory, { withFileTypes: true });
    const visibleEntries = await Promise.all(entries.slice(0, MAX_RESULTS).map(async entry => {
      if (!entry.isDirectory()) return { entry, hasChildren: undefined };
      const children = await readdir(join(directory, entry.name), { withFileTypes: true }).catch(() => []);
      return { entry, hasChildren: children.length > 0 };
    }));
    return visibleEntries
      .sort((left, right) => Number(right.entry.isDirectory()) - Number(left.entry.isDirectory()) || left.entry.name.localeCompare(right.entry.name))
      .map(({ entry, hasChildren }) => ({ path: join(directory, entry.name), kind: entry.isDirectory() ? 'folder' : 'file', ...(hasChildren === undefined ? {} : { hasChildren }) }));
  }
  async readFile(input: string): Promise<string> {
    const file = await requireAbsoluteFile(input);
    const details = await stat(file);
    if (details.size > DESKTOP_RUNTIME_LIMITS.hostFileBytes) throw new Error('The selected file is too large to preview.');
    return readFile(file, 'utf8');
  }
  async previewFile(input: string): Promise<DesktopFilePreview> {
    const file = await requireAbsoluteFile(input);
    const kind = artifactKind(file);
    const details = await stat(file);
    if (kind === 'image' || kind === 'audio' || kind === 'video') {
      if (details.size > DESKTOP_RUNTIME_LIMITS.attachmentBytes) throw new Error('The media file exceeds the supported preview size.');
      return { kind, media: { mimeType: artifactMimeType({ kind, name: basename(file) }), bytes: Uint8Array.from(await readFile(file)) } };
    }
    if (kind === 'text' || kind === 'markdown' || kind === 'patch' || kind === 'json') {
      if (details.size > DESKTOP_RUNTIME_LIMITS.hostFileBytes) throw new Error('The selected file is too large to preview.');
      return { kind, content: await readFile(file, 'utf8') };
    }
    return { kind };
  }
  emitDeepLink(url: string): void { for (const window of BrowserWindow.getAllWindows()) window.webContents.send('operations.deepLink', url); }
  async exportDiagnostics(input: { version: string; settings: Record<string, unknown> }): Promise<string> { const directory = join(app.getPath('downloads'), 'lotagate-diagnostics'); await mkdir(directory, { recursive: true }); const path = join(directory, `diagnostics-${Date.now()}.json`); await writeFile(path, JSON.stringify({ appVersion: input.version, platform: process.platform, arch: process.arch, createdAt: new Date().toISOString(), settings: input.settings }, null, 2), 'utf8'); return path; }
}

async function requireAbsoluteDirectory(input: string): Promise<string> {
  const path = await requireAbsolutePath(input);
  const details = await stat(path);
  if (!details.isDirectory()) throw new Error('The selected path is not a directory.');
  return path;
}

async function requireAbsoluteFile(input: string): Promise<string> {
  const path = await requireAbsolutePath(input);
  const details = await stat(path);
  if (!details.isFile()) throw new Error('The selected path is not a regular file.');
  return path;
}

async function requireAbsolutePath(input: string): Promise<string> {
  if (!isAbsolute(input)) throw new Error('The file path must be absolute.');
  return resolve(input);
}

function openInVsCode(path: string): Promise<void> {
  const windows = process.platform === 'win32';
  const command = windows ? (process.env['ComSpec'] ?? 'cmd.exe') : 'code';
  const args = windows ? ['/d', '/s', '/c', `call code.cmd --reuse-window ${quoteWindowsCommandArgument(path)}`] : ['--reuse-window', path];
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { detached: true, shell: false, windowsHide: true, windowsVerbatimArguments: windows, stdio: 'ignore' });
    child.once('error', reject);
    child.once('spawn', () => { child.unref(); resolve(); });
  });
}

function quoteWindowsCommandArgument(value: string): string {
  return `"${value.replace(/["&|<>()^%]/gu, character => `^${character}`)}"`;
}
