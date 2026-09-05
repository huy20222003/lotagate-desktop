import { describe, expect, it } from 'vitest';
import { desktopReleaseSchema } from './update.js';

describe('desktop update contract', () => {
  it('accepts the server public release shape', () => {
    const result = desktopReleaseSchema.safeParse({
      id: 'release-1', productCode: 'lotagate-desktop', version: '0.2.0', channel: 'STABLE', status: 'PUBLISHED', title: 'Update', releaseNotes: 'Fixes', minimumSupportedVersion: null, isMandatory: false, publishedAt: '2026-09-05T00:00:00.000Z', createdAt: '2026-09-05T00:00:00.000Z', updatedAt: '2026-09-05T00:00:00.000Z',
      assets: [{ id: 'asset-1', platform: 'WINDOWS', architecture: 'X64', format: 'MSI', fileName: 'LotaGate.msi', contentType: 'application/x-msi', sizeBytes: '5', sha256: 'a'.repeat(64), status: 'READY', isRecommended: true, downloadUrl: 'https://cdn.example.test/LotaGate.msi', uploadedAt: '2026-09-05T00:00:00.000Z', createdAt: '2026-09-05T00:00:00.000Z', updatedAt: '2026-09-05T00:00:00.000Z' }],
    });
    expect(result.success).toBe(true);
  });

  it('represents an asset that cannot be downloaded until its URL and checksum are ready', () => {
    const result = desktopReleaseSchema.safeParse({ id: 'release-1', productCode: 'lotagate-desktop', version: '0.2.0', channel: 'STABLE', status: 'PUBLISHED', title: null, releaseNotes: null, minimumSupportedVersion: null, isMandatory: false, publishedAt: null, createdAt: '2026-09-05T00:00:00.000Z', updatedAt: '2026-09-05T00:00:00.000Z', assets: [{ id: 'asset-1', platform: 'WINDOWS', architecture: 'X64', format: 'MSI', fileName: 'LotaGate.msi', contentType: 'application/x-msi', sizeBytes: null, sha256: null, status: 'READY', isRecommended: false, downloadUrl: null, uploadedAt: null, createdAt: '2026-09-05T00:00:00.000Z', updatedAt: '2026-09-05T00:00:00.000Z' }] });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.assets[0]?.downloadUrl).toBeNull();
    expect(result.data.assets[0]?.sha256).toBeNull();
  });
});
