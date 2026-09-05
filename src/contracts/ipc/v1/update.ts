import { z } from 'zod';

export const desktopReleasePlatformSchema = z.enum(['WINDOWS', 'MACOS', 'LINUX']);
export const desktopReleaseArchitectureSchema = z.enum(['X64', 'ARM64']);
export const desktopReleaseFormatSchema = z.enum(['MSI', 'DMG', 'PKG', 'DEB', 'RPM', 'ZIP', 'APPIMAGE']);

export const desktopReleaseAssetSchema = z.object({
  id: z.string().min(1),
  platform: desktopReleasePlatformSchema,
  architecture: desktopReleaseArchitectureSchema,
  format: desktopReleaseFormatSchema,
  fileName: z.string().min(1),
  contentType: z.string().min(1),
  sizeBytes: z.string().regex(/^\d+$/u).nullable(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/iu).nullable(),
  status: z.string().min(1),
  isRecommended: z.boolean(),
  downloadUrl: z.string().url().nullable(),
  uploadedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
}).strict();

export const desktopReleaseSchema = z.object({
  id: z.string().min(1),
  productCode: z.string().min(1),
  version: z.string().min(1),
  channel: z.string().min(1),
  status: z.string().min(1),
  title: z.string().nullable(),
  releaseNotes: z.string().nullable(),
  minimumSupportedVersion: z.string().nullable(),
  isMandatory: z.boolean(),
  publishedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  assets: z.array(desktopReleaseAssetSchema),
}).strict();

export type DesktopReleasePlatform = z.infer<typeof desktopReleasePlatformSchema>;
export type DesktopReleaseArchitecture = z.infer<typeof desktopReleaseArchitectureSchema>;
export type DesktopReleaseFormat = z.infer<typeof desktopReleaseFormatSchema>;
export type DesktopReleaseAsset = z.infer<typeof desktopReleaseAssetSchema>;
export type DesktopRelease = z.infer<typeof desktopReleaseSchema>;

export type DesktopUpdatePhase = 'disabled' | 'checking' | 'up-to-date' | 'available' | 'downloading' | 'ready' | 'installing' | 'unavailable' | 'error';

export interface DesktopAppVersionInfo {
  productName: string;
  applicationId: string;
  version: string;
  cliVersion: string | null;
  electronVersion: string;
  nodeVersion: string;
  platform: DesktopReleasePlatform;
  architecture: DesktopReleaseArchitecture;
  updateChannel: string;
  packaged: boolean;
}

export interface DesktopUpdateSnapshot {
  phase: DesktopUpdatePhase;
  currentVersion: string;
  platform: DesktopReleasePlatform;
  architecture: DesktopReleaseArchitecture;
  release: DesktopRelease | null;
  asset: DesktopReleaseAsset | null;
  blocking: boolean;
  bytesDownloaded: number;
  totalBytes: number | null;
  downloadedFileName: string | null;
  error: string | null;
}

export interface DesktopUpdatesApi {
  getInfo(): Promise<DesktopAppVersionInfo>;
  getState(): Promise<DesktopUpdateSnapshot>;
  check(): Promise<DesktopUpdateSnapshot>;
  download(): Promise<DesktopUpdateSnapshot>;
  cancel(): Promise<DesktopUpdateSnapshot>;
  install(): Promise<DesktopUpdateSnapshot>;
  onState(listener: (snapshot: DesktopUpdateSnapshot) => void): () => void;
}
