import { app, type WebContents } from 'electron';
import { mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { basename, join } from 'node:path';

export type BrowserDownloadResult = { found: boolean; path?: string; filename?: string; sizeBytes?: number; description: string };
export type PendingBrowserDownload = { path: string; resolve: (result: BrowserDownloadResult) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> };
export type BrowserDownloadState = { pending: PendingBrowserDownload | undefined };

export async function downloadBrowserResource(state: BrowserDownloadState, contents: WebContents, url: string, configuredDirectory = ''): Promise<BrowserDownloadResult> {
  if (state.pending !== undefined) throw new Error('A browser download is already in progress.');
  const directory = configuredDirectory.trim().length > 0 ? configuredDirectory : join(app.getPath('downloads'), 'LotaGate Browser');
  await mkdir(directory, { recursive: true });
  const filename = safeFilename(basename(new URL(url).pathname) || 'download');
  const destination = join(directory, `${Date.now()}-${randomUUID()}-${filename}`);
  const result = new Promise<BrowserDownloadResult>((resolve, reject) => {
    const timer = setTimeout(() => {
      if (state.pending?.path !== destination) return;
      state.pending = undefined;
      reject(new Error('Browser download timed out.'));
    }, 30_000);
    state.pending = { path: destination, resolve, reject, timer };
  });
  try { contents.downloadURL(url); }
  catch (error) {
    const pending = state.pending as PendingBrowserDownload | undefined;
    if (pending !== undefined && pending.path === destination) { clearTimeout(pending.timer); state.pending = undefined; pending.reject(error instanceof Error ? error : new Error('Unable to start browser download.')); }
  }
  return result;
}

function safeFilename(value: string): string { const normalized = value.replace(/[^A-Za-z0-9._-]/gu, '_').slice(0, 160); return normalized.length > 0 && normalized !== '.' && normalized !== '..' ? normalized : 'download'; }
