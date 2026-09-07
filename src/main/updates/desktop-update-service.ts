import { app, net, shell } from 'electron';
import { createHash, randomUUID } from 'node:crypto';
import { chmod, mkdir, open, readdir, rename, unlink } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { createRequire } from 'node:module';
import { API_PATHS } from '../api/api-contract.js';
import type { ApiTransport } from '../api/api-transport.js';
import { DESKTOP_APP_USER_MODEL_ID, DESKTOP_PRODUCT_NAME } from '../app-identity.js';
import type { DesktopLogger } from '../observability/desktop-logger.js';
import { desktopReleaseSchema, type DesktopAppVersionInfo, type DesktopRelease, type DesktopReleaseArchitecture, type DesktopReleaseAsset, type DesktopReleaseFormat, type DesktopReleasePlatform, type DesktopUpdateSnapshot } from '../../contracts/ipc/v1/update.js';
import { isDesktopVersionBelow, isDesktopVersionNewer, isValidDesktopVersion } from './desktop-update-version.js';
import { MAX_DOWNLOAD_ATTEMPTS, MAX_DOWNLOAD_BYTES, RETRY_DELAY_MS } from './update-constants.js';
const require = createRequire(import.meta.url);

export class DesktopUpdateService {
  private readonly listeners = new Set<(snapshot: DesktopUpdateSnapshot) => void>();
  private state: DesktopUpdateSnapshot;
  private checkOperation: Promise<DesktopUpdateSnapshot> | undefined;
  private downloadOperation: Promise<DesktopUpdateSnapshot> | undefined;
  private downloadController: AbortController | undefined;
  private downloadedPath: string | undefined;
  private downloadedAssetId: string | undefined;

  constructor(private readonly transport: Pick<ApiTransport, 'request'>, private readonly logger?: DesktopLogger) {
    const info = this.readInfo();
    this.state = this.createSnapshot('disabled', info);
  }

  getInfo(): DesktopAppVersionInfo { return this.readInfo(); }
  getState(): DesktopUpdateSnapshot { return this.state; }

  onState(listener: (snapshot: DesktopUpdateSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async check(): Promise<DesktopUpdateSnapshot> {
    if (!app.isPackaged) return this.publish(this.createSnapshot('disabled', this.readInfo()));
    if (this.checkOperation !== undefined) return this.checkOperation;
    this.checkOperation = this.performCheck().finally(() => { this.checkOperation = undefined; });
    return this.checkOperation;
  }

  async download(): Promise<DesktopUpdateSnapshot> {
    if (this.downloadOperation !== undefined) return this.downloadOperation;
    if (this.state.phase === 'ready') return this.state;
    if (this.state.phase !== 'available' || this.state.release === null || this.state.asset === null) throw new Error('No compatible desktop update is available.');
    this.downloadController = new AbortController();
    this.downloadOperation = this.performDownload(this.state.release, this.state.asset, this.downloadController.signal).finally(() => { this.downloadOperation = undefined; this.downloadController = undefined; });
    return this.downloadOperation;
  }

  async cancel(): Promise<DesktopUpdateSnapshot> {
    this.downloadController?.abort();
    if (this.downloadOperation !== undefined) await this.downloadOperation.catch(() => undefined);
    if (this.state.phase === 'downloading') return this.publish({ ...this.state, phase: 'available', bytesDownloaded: 0, totalBytes: null, error: null });
    return this.state;
  }

  async install(): Promise<DesktopUpdateSnapshot> {
    if (this.state.phase !== 'ready' || this.downloadedPath === undefined || this.state.asset === null || this.downloadedAssetId !== this.state.asset.id) throw new Error('Download the desktop update before installing it.');
    if (this.state.asset.format === 'APPIMAGE') await chmod(this.downloadedPath, 0o755);
    this.publish({ ...this.state, phase: 'installing', error: null });
    const error = await shell.openPath(this.downloadedPath);
    if (error) {
      const snapshot = this.publish({ ...this.state, phase: 'error', error: error.trim() || 'The operating system could not open the downloaded update.' });
      throw new Error(snapshot.error ?? 'The operating system could not open the downloaded update.');
    }
    app.quit();
    return this.state;
  }

  private async performCheck(): Promise<DesktopUpdateSnapshot> {
    const info = this.readInfo();
    this.publish(this.createSnapshot('checking', info));
    try {
      const raw = await this.transport.request<unknown>(API_PATHS.desktopDownloadsLatest, 'GET');
      if (raw === null) return this.publish(this.createSnapshot('up-to-date', info));
      const release = desktopReleaseSchema.parse(raw);
      if (release.productCode !== 'lotagate-desktop' || !isValidDesktopVersion(release.version)) throw new Error('The desktop update metadata is invalid.');
      const asset = selectAsset(release.assets, info.platform, info.architecture);
      const belowMinimum = release.minimumSupportedVersion !== null && isDesktopVersionBelow(info.version, release.minimumSupportedVersion);
      const newer = isDesktopVersionNewer(release.version, info.version);
      if (!newer && !belowMinimum) return this.publish({ ...this.createSnapshot('up-to-date', info), release, asset, blocking: false });
      if (asset === null || asset.downloadUrl === null || asset.sha256 === null) return this.publish({ ...this.createSnapshot('unavailable', info), release, asset, blocking: release.isMandatory || belowMinimum, error: 'A compatible signed installer is not available for this device.' });
      return this.publish({ ...this.createSnapshot('available', info), release, asset, blocking: release.isMandatory || belowMinimum });
    } catch (error) {
      this.logger?.warn('updates.check.failed', { message: error instanceof Error ? error.message : 'Unable to check for desktop updates.' });
      return this.publish({ ...this.createSnapshot('error', info), error: error instanceof Error ? error.message : 'Unable to check for desktop updates.' });
    }
  }

  private async performDownload(release: DesktopRelease, asset: DesktopReleaseAsset, signal: AbortSignal): Promise<DesktopUpdateSnapshot> {
    const totalBytes = parseSize(asset.sizeBytes);
    const directory = join(app.getPath('temp'), 'lotagate-updates');
    await mkdir(directory, { recursive: true });
    await removeStaleDownloads(directory);
    const fileName = safeFileName(asset.fileName);
    const target = join(directory, `${randomUUID()}-${fileName}`);
    const partial = `${target}.part`;
    this.publish({ ...this.state, phase: 'downloading', bytesDownloaded: 0, totalBytes, error: null });
    try {
      let lastError: unknown;
      for (let attempt = 1; attempt <= MAX_DOWNLOAD_ATTEMPTS; attempt += 1) {
        try {
          await this.downloadOnce(asset.downloadUrl as string, partial, asset, signal);
          lastError = undefined;
          break;
        } catch (error) {
          lastError = error;
          if (signal.aborted || !isRetryableDownloadError(error) || attempt === MAX_DOWNLOAD_ATTEMPTS) break;
          await delay(RETRY_DELAY_MS * attempt, signal);
        }
      }
      if (lastError !== undefined) throw lastError;
      await rename(partial, target);
      this.downloadedPath = target;
      this.downloadedAssetId = asset.id;
      return this.publish({ ...this.state, phase: 'ready', release, asset, bytesDownloaded: totalBytes ?? this.state.bytesDownloaded, totalBytes, downloadedFileName: fileName, error: null });
    } catch (error) {
      await unlink(partial).catch(() => undefined);
      const message = signal.aborted ? 'The desktop update download was cancelled.' : error instanceof Error ? error.message : 'Unable to download the desktop update.';
      this.logger?.warn('updates.download.failed', { version: release.version, format: asset.format, message });
      this.publish({ ...this.state, phase: 'available', bytesDownloaded: 0, totalBytes: null, error: message });
      throw new Error(message);
    }
  }

  private async downloadOnce(url: string, partial: string, asset: DesktopReleaseAsset, signal: AbortSignal): Promise<void> {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') throw new Error('Desktop update downloads must use HTTPS.');
    const response = await net.fetch(parsed.toString(), { signal });
    if (!response.ok) throw new RetryableDownloadError(`Desktop update download failed (${response.status}).`, response.status >= 500 || response.status === 429);
    if (response.body === null) throw new RetryableDownloadError('Desktop update response has no body.', true);
    const handle = await open(partial, 'w');
    const reader = response.body.getReader();
    const hash = createHash('sha256');
    let downloaded = 0;
    try {
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        downloaded += next.value.byteLength;
        if (downloaded > MAX_DOWNLOAD_BYTES || (asset.sizeBytes !== null && downloaded > Number(asset.sizeBytes))) throw new Error('The desktop update exceeds its declared size.');
        hash.update(next.value);
        await handle.write(next.value);
        this.publish({ ...this.state, bytesDownloaded: downloaded });
      }
    } finally {
      reader.releaseLock();
      await handle.close();
    }
    if (downloaded === 0) throw new Error('The desktop update is empty.');
    if (asset.sizeBytes !== null && downloaded !== Number(asset.sizeBytes)) throw new Error('The desktop update size does not match its metadata.');
    if (asset.sha256 === null || hash.digest('hex').toLowerCase() !== asset.sha256.toLowerCase()) throw new Error('The desktop update checksum does not match its metadata.');
  }

  private readInfo(): DesktopAppVersionInfo {
    let cliVersion: string | null = null;
    try {
      const manifest = require('@lotagate/cli/package.json') as { version?: unknown };
      if (typeof manifest.version === 'string') cliVersion = manifest.version;
    } catch { cliVersion = null; }
    return { productName: DESKTOP_PRODUCT_NAME, applicationId: DESKTOP_APP_USER_MODEL_ID, version: app.getVersion(), cliVersion, electronVersion: process.versions.electron ?? 'unknown', nodeVersion: process.versions.node ?? 'unknown', platform: resolvePlatform(process.platform), architecture: resolveArchitecture(process.arch), updateChannel: 'STABLE', packaged: app.isPackaged };
  }

  private createSnapshot(phase: DesktopUpdateSnapshot['phase'], info: DesktopAppVersionInfo): DesktopUpdateSnapshot {
    return { phase, currentVersion: info.version, platform: info.platform, architecture: info.architecture, release: null, asset: null, blocking: false, bytesDownloaded: 0, totalBytes: null, downloadedFileName: null, error: null };
  }

  private publish(snapshot: DesktopUpdateSnapshot): DesktopUpdateSnapshot { this.state = snapshot; for (const listener of this.listeners) listener(snapshot); return snapshot; }
}

class RetryableDownloadError extends Error {
  constructor(message: string, readonly retryable: boolean) { super(message); }
}

function isRetryableDownloadError(error: unknown): boolean { return error instanceof RetryableDownloadError ? error.retryable : !(error instanceof Error && error.message.includes('checksum')); }
function parseSize(value: string | null): number | null { if (value === null) return null; const parsed = Number(value); if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed > MAX_DOWNLOAD_BYTES) throw new Error('The desktop update size is invalid.'); return parsed; }
function safeFileName(value: string): string { const result = basename(value).replace(/[^a-zA-Z0-9._-]/gu, '-'); return result || 'lotagate-update'; }
function selectAsset(assets: DesktopReleaseAsset[], platform: DesktopReleasePlatform, architecture: DesktopReleaseArchitecture): DesktopReleaseAsset | null {
  const formats: DesktopReleaseFormat[] = platform === 'WINDOWS' ? ['MSI', 'ZIP'] : platform === 'MACOS' ? ['PKG', 'DMG', 'ZIP'] : ['DEB', 'RPM', 'APPIMAGE'];
  return assets.filter(asset => asset.platform === platform && asset.architecture === architecture && formats.includes(asset.format) && asset.status === 'READY').sort((left, right) => Number(right.isRecommended) - Number(left.isRecommended) || formats.indexOf(left.format) - formats.indexOf(right.format))[0] ?? null;
}
function resolvePlatform(value: NodeJS.Platform): DesktopReleasePlatform { if (value === 'win32') return 'WINDOWS'; if (value === 'darwin') return 'MACOS'; if (value === 'linux') return 'LINUX'; throw new Error(`Unsupported desktop platform: ${value}`); }
function resolveArchitecture(value: string): DesktopReleaseArchitecture { if (value === 'x64') return 'X64'; if (value === 'arm64') return 'ARM64'; throw new Error(`Unsupported desktop architecture: ${value}`); }
function delay(milliseconds: number, signal: AbortSignal): Promise<void> { return new Promise((resolvePromise, reject) => { const timer = setTimeout(resolvePromise, milliseconds); signal.addEventListener('abort', () => { clearTimeout(timer); reject(new Error('The desktop update download was cancelled.')); }, { once: true }); }); }
async function removeStaleDownloads(directory: string): Promise<void> { const entries = await readdir(directory, { withFileTypes: true }); await Promise.all(entries.filter(entry => entry.isFile() && /^[0-9a-f-]{36}-.+/iu.test(entry.name)).map(entry => unlink(join(directory, entry.name)).catch(() => undefined))); }
