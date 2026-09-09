import { createHash, createSign, generateKeyPairSync } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DesktopUpdateService } from './desktop-update-service.js';

const mocks = vi.hoisted(() => ({
  app: { isPackaged: true, getVersion: vi.fn(() => '0.1.0'), getPath: vi.fn(), quit: vi.fn() },
  net: { fetch: vi.fn() },
  shell: { openPath: vi.fn(async () => '') },
}));

vi.mock('electron', () => mocks);

const signingKeys = generateKeyPairSync('rsa', { modulusLength: 2048 });
const publicKey = signingKeys.publicKey.export({ format: 'der', type: 'spki' }).toString('base64');

describe('DesktopUpdateService', () => {
  let temporaryDirectory: string;

  afterEach(async () => {
    vi.clearAllMocks();
    if (temporaryDirectory !== undefined) await rm(temporaryDirectory, { recursive: true, force: true });
  });

  it('selects the current platform asset and reports an available release', async () => {
    const transport = { request: vi.fn().mockResolvedValue(release({ version: '0.2.0' })) };
    const service = new DesktopUpdateService(transport, undefined, publicKey);
    const snapshot = await service.check();
    const asset = currentAsset();
    expect(snapshot.phase).toBe('available');
    expect(snapshot.asset?.format).toBe(asset.format);
    expect(snapshot.blocking).toBe(false);
  });

  it('downloads, hashes, and installs the selected artifact', async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), 'lotagate-update-'));
    mocks.app.getPath.mockReturnValue(temporaryDirectory);
    const content = Buffer.from('installer-content');
    const asset = release({ version: '0.2.0', sizeBytes: String(content.length), sha256: createHash('sha256').update(content).digest('hex') }).assets[0];
    mocks.net.fetch.mockResolvedValue(new Response(content, { status: 200 }));
    const service = new DesktopUpdateService({ request: vi.fn().mockResolvedValue(release({ version: '0.2.0', sizeBytes: String(content.length), sha256: asset?.sha256 ?? '' })) }, undefined, publicKey);
    await service.check();
    const ready = await service.download();
    const expectedAsset = currentAsset();
    expect(ready.phase).toBe('ready');
    expect(ready.downloadedFileName).toBe(expectedAsset.fileName);
    const files = await readdir(join(temporaryDirectory, 'lotagate-updates'));
    expect(files).toHaveLength(1);
    expect(await readFile(join(temporaryDirectory, 'lotagate-updates', files[0] as string))).toEqual(content);
    await service.install();
    expect(mocks.shell.openPath).toHaveBeenCalledOnce();
    expect(mocks.app.quit).toHaveBeenCalledOnce();
  });

  it('rejects an artifact with an invalid detached signature', async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), 'lotagate-update-'));
    mocks.app.getPath.mockReturnValue(temporaryDirectory);
    const content = Buffer.from('installer-content');
    const service = new DesktopUpdateService({ request: vi.fn().mockResolvedValue(release({ version: '0.2.0', sizeBytes: String(content.length), signature: 'invalid-signature' })) }, undefined, publicKey);
    mocks.net.fetch.mockResolvedValue(new Response(content, { status: 200 }));
    await service.check();
    await expect(service.download()).rejects.toThrow('signature does not match');
    expect(service.getState().phase).toBe('available');
    expect(mocks.shell.openPath).not.toHaveBeenCalled();
  });
});

function release(overrides: { version?: string; sizeBytes?: string; sha256?: string; signature?: string } = {}) {
  const content = Buffer.from('installer-content');
  const asset = currentAsset();
  const signer = createSign('sha256');
  signer.update(content);
  return {
    id: 'release-1', productCode: 'lotagate-desktop', version: overrides.version ?? '0.2.0', channel: 'STABLE', status: 'PUBLISHED', title: 'LotaGate update', releaseNotes: 'Updates', minimumSupportedVersion: null, isMandatory: false, publishedAt: '2026-09-05T00:00:00.000Z', createdAt: '2026-09-05T00:00:00.000Z', updatedAt: '2026-09-05T00:00:00.000Z',
    assets: [{ id: 'asset-1', platform: asset.platform, architecture: asset.architecture, format: asset.format, fileName: asset.fileName, contentType: asset.contentType, sizeBytes: overrides.sizeBytes ?? String(content.length), sha256: overrides.sha256 ?? createHash('sha256').update(content).digest('hex'), signature: overrides.signature ?? signer.sign(signingKeys.privateKey).toString('base64url'), status: 'READY', isRecommended: true, downloadUrl: `https://cdn.example.test/${asset.fileName}`, uploadedAt: '2026-09-05T00:00:00.000Z', createdAt: '2026-09-05T00:00:00.000Z', updatedAt: '2026-09-05T00:00:00.000Z' }],
  };
}

function currentAsset(): { platform: 'WINDOWS' | 'MACOS' | 'LINUX'; architecture: 'X64' | 'ARM64'; format: 'MSI' | 'PKG' | 'DEB'; fileName: string; contentType: string } {
  if (process.platform === 'win32') return { platform: 'WINDOWS', architecture: process.arch === 'arm64' ? 'ARM64' : 'X64', format: 'MSI', fileName: 'LotaGate.msi', contentType: 'application/x-msi' };
  if (process.platform === 'darwin') return { platform: 'MACOS', architecture: process.arch === 'arm64' ? 'ARM64' : 'X64', format: 'PKG', fileName: 'LotaGate.pkg', contentType: 'application/octet-stream' };
  return { platform: 'LINUX', architecture: process.arch === 'arm64' ? 'ARM64' : 'X64', format: 'DEB', fileName: 'LotaGate.deb', contentType: 'application/vnd.debian.binary-package' };
}
