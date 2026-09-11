import { readdir, stat, unlink } from 'node:fs/promises';
import type { BrowserSettings } from '../../contracts/ipc/v1/settings.js';
import type { BrowserEvidence, BrowserViewBounds } from '../../contracts/ipc/v1/workspace.js';
import { desktopDataPath } from '../persistence/app-data-paths.js';
import type { BrowserViewport } from './browser-devtools.js';

export function parseHttpUrl(value: string): URL {
  const parsed = new URL(value);
  if (!isHttpUrl(parsed.toString())) throw new Error('Browser navigation only supports HTTP(S) URLs.');
  return parsed;
}

export function isAllowedOrigin(value: string, allowlist: readonly string[]): boolean {
  if (value === 'about:blank' || allowlist.length === 0) return true;
  try {
    const parsed = new URL(value);
    return allowlist.some(item => {
      try { return new URL(item).origin === parsed.origin; }
      catch { return item.trim() === parsed.origin; }
    });
  } catch { return false; }
}

export function assertOriginAllowed(value: URL, allowlist: readonly string[]): void {
  if (!isAllowedOrigin(value.toString(), allowlist)) throw new Error(`Browser origin is not allowed: ${value.origin}.`);
}

export function viewportForSettings(settings: BrowserSettings): BrowserViewport | undefined {
  if (settings.viewportProfile === 'custom') return { ...settings.customViewport };
  const profiles: Record<Exclude<BrowserSettings['viewportProfile'], 'custom'>, BrowserViewport> = {
    desktop: { width: 1_280, height: 800, mobile: false, deviceScaleFactor: 1 },
    laptop: { width: 1_440, height: 900, mobile: false, deviceScaleFactor: 1 },
    tablet: { width: 1_024, height: 768, mobile: true, deviceScaleFactor: 2 },
    mobile: { width: 390, height: 844, mobile: true, deviceScaleFactor: 3 },
  };
  return profiles[settings.viewportProfile];
}

export async function pruneEvidenceFiles(retentionDays: number): Promise<void> {
  try {
    const directory = desktopDataPath('browser-evidence');
    const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1_000;
    for (const name of await readdir(directory)) {
      const path = `${directory}/${name}`;
      const details = await stat(path).catch(() => undefined);
      if (details?.isFile() && details.mtimeMs < cutoff) await unlink(path).catch(() => undefined);
    }
  } catch { /* The evidence directory is created lazily on first capture. */ }
}

export function defaultBrowserSettings(): BrowserSettings {
  return { viewportProfile: 'desktop', customViewport: { width: 1_280, height: 800, mobile: false, deviceScaleFactor: 1 }, downloadDirectory: '', sessionRetention: 'persistent', sessionRetentionMinutes: 60, originAllowlist: [], clearDataOnClose: false, evidenceRetentionDays: 30 };
}

export function isHttpUrl(value: string): boolean { try { const protocol = new URL(value).protocol; return protocol === 'http:' || protocol === 'https:'; } catch { return false; } }
export function serializeForJavaScript(value: unknown): string { return JSON.stringify(value).replace(/\u2028/gu, '\\u2028').replace(/\u2029/gu, '\\u2029'); }
export function safeUrl(value: string): string { try { const url = new URL(value); url.username = ''; url.password = ''; url.hash = ''; for (const key of [...url.searchParams.keys()]) if (/token|key|secret|password|auth|signature/iu.test(key)) url.searchParams.set(key, '[REDACTED]'); return url.toString().slice(0, 4_096); } catch { return redact(value); } }
export function normalizeBounds(bounds: BrowserViewBounds): BrowserViewBounds { return { x: Math.max(0, Math.floor(bounds.x)), y: Math.max(0, Math.floor(bounds.y)), width: Math.min(10_000, Math.max(1, Math.floor(bounds.width))), height: Math.min(10_000, Math.max(1, Math.floor(bounds.height))) }; }
export function viewportForBounds(viewport: BrowserViewport, bounds: BrowserViewBounds): BrowserViewport {
  return { ...viewport, width: Math.min(viewport.width, Math.max(1, Math.floor(bounds.width))), height: Math.min(viewport.height, Math.max(1, Math.floor(bounds.height))) };
}
export function consoleLevel(level: 'info' | 'warning' | 'error' | 'debug'): string { return level; }
export function redact(value: string): string { return value.replace(/Bearer\s+[^\s]+/giu, 'Bearer [REDACTED]').replace(/sk-[A-Za-z0-9_-]{8,}/gu, '[REDACTED]').slice(0, 4_096); }
export function cloneEvidence(value: BrowserEvidence): BrowserEvidence { return { ...value, console: [...value.console], errors: [...value.errors], screenshots: [...value.screenshots], recordings: [...value.recordings] }; }
export function appendCapped<T>(items: T[], value: T, limit: number): void { items.push(value); if (items.length > limit) items.splice(0, items.length - limit); }
export function delay(milliseconds: number): Promise<void> { return new Promise(resolve => setTimeout(resolve, milliseconds)); }

export function isPageInspection(value: unknown): value is { visibleText: string; readyState: string; html: string; headings: Array<{ level: number; text: string }>; links: Array<{ text: string; url: string }>; elements: Array<{ role: string; name: string; tag: string; type?: string; disabled: boolean }> } {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record['visibleText'] === 'string' && typeof record['readyState'] === 'string' && typeof record['html'] === 'string' && Array.isArray(record['headings']) && Array.isArray(record['links']) && Array.isArray(record['elements']);
}

export function isElementInspection(value: unknown): value is { found: boolean; description: string } { return typeof value === 'object' && value !== null && typeof (value as Record<string, unknown>)['found'] === 'boolean' && typeof (value as Record<string, unknown>)['description'] === 'string'; }
export function isInteractionResult(value: unknown): value is { found: boolean; description: string } {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record['found'] === 'boolean' && typeof record['description'] === 'string';
}
