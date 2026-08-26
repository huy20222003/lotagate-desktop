import { BrowserWindow, session } from 'electron';
import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { desktopDataPath } from '../persistence/app-data-paths.js';

export interface BrowserConsoleEntry { level: string; message: string; timestamp: string; }
export interface BrowserEvidence { id: string; url: string; title: string; console: BrowserConsoleEntry[]; errors: string[]; screenshots: string[]; recordings: string[]; createdAt: string; }
export interface BrowserScreenshot { evidenceId: string; path: string; dataUrl: string; }

type BrowserEntry = { window: BrowserWindow; evidence: BrowserEvidence; recordingTimer: ReturnType<typeof setInterval> | undefined; recordingCaptureInFlight: boolean };
const MAX_CONSOLE_ENTRIES = 200;
const MAX_ERROR_ENTRIES = 100;

export class BrowserService {
  private readonly windows = new Map<string, BrowserEntry>();

  async open(url: string, approved: boolean): Promise<{ id: string; url: string }> {
    if (!approved) throw new Error('Browser navigation requires explicit approval.');
    const parsed = parseHttpUrl(url);
    const id = randomUUID();
    const browser = new BrowserWindow({ width: 1200, height: 800, webPreferences: { session: session.fromPartition(`persist:lotagate-browser-${id}`), nodeIntegration: false, contextIsolation: true, sandbox: true } });
    const evidence: BrowserEvidence = { id, url: parsed.toString(), title: '', console: [], errors: [], screenshots: [], recordings: [], createdAt: new Date().toISOString() };
    const entry: BrowserEntry = { window: browser, evidence, recordingTimer: undefined, recordingCaptureInFlight: false };
    this.windows.set(id, entry);
    browser.on('closed', () => { const current = this.windows.get(id); if (current?.recordingTimer) clearInterval(current.recordingTimer); this.windows.delete(id); });
    browser.webContents.on('will-navigate', (event, destination) => { if (!isHttpUrl(destination)) event.preventDefault(); });
    browser.webContents.setWindowOpenHandler(({ url: destination }) => ({ action: isHttpUrl(destination) ? 'allow' : 'deny' }));
    browser.webContents.on('console-message', (_event, level, message) => { appendCapped(evidence.console, { level: consoleLevel(level), message: redact(message), timestamp: new Date().toISOString() }, MAX_CONSOLE_ENTRIES); });
    browser.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => { appendCapped(evidence.errors, redact(`${errorCode}: ${errorDescription}`), MAX_ERROR_ENTRIES); });
    browser.webContents.on('render-process-gone', (_event, details) => { appendCapped(evidence.errors, redact(`Render process ended: ${details.reason}`), MAX_ERROR_ENTRIES); });
    browser.webContents.session.on('will-download', (_event, item) => { item.cancel(); appendCapped(evidence.errors, 'Downloads require an explicit approved desktop download action.', MAX_ERROR_ENTRIES); });
    try {
      await browser.loadURL(parsed.toString());
      evidence.title = await browser.webContents.getTitle();
    } catch (error) {
      this.windows.delete(id);
      browser.destroy();
      throw error;
    }
    return { id, url: parsed.toString() };
  }

  async close(id: string): Promise<void> { const entry = this.windows.get(id); if (entry?.recordingTimer) clearInterval(entry.recordingTimer); entry?.window.close(); this.windows.delete(id); }

  async screenshot(id: string): Promise<BrowserScreenshot> {
    const entry = this.require(id);
    const { path, bytes } = await this.capture(entry);
    entry.evidence.screenshots.push(path);
    return { evidenceId: id, path, dataUrl: `data:image/png;base64,${bytes.toString('base64')}` };
  }

  async startRecording(id: string): Promise<void> {
    const entry = this.require(id);
    if (entry.recordingTimer) return;
    await this.captureRecordingFrame(entry);
    entry.recordingTimer = setInterval(() => { void this.captureRecordingFrame(entry); }, 2_000);
  }

  async stopRecording(id: string): Promise<BrowserEvidence> {
    const entry = this.require(id);
    if (entry.recordingTimer) clearInterval(entry.recordingTimer);
    entry.recordingTimer = undefined;
    await this.captureRecordingFrame(entry);
    return cloneEvidence(entry.evidence);
  }

  list(): BrowserEvidence[] { return [...this.windows.values()].map(entry => cloneEvidence(entry.evidence)); }
  evidence(id: string): BrowserEvidence { return cloneEvidence(this.require(id).evidence); }
  async closeAll(): Promise<void> { for (const [id] of this.windows) await this.close(id); }
  private require(id: string): BrowserEntry { const entry = this.windows.get(id); if (entry === undefined) throw new Error('Browser session was not found.'); return entry; }
  private async captureRecordingFrame(entry: BrowserEntry): Promise<void> {
    if (entry.evidence.recordings.length >= 30) { if (entry.recordingTimer) clearInterval(entry.recordingTimer); entry.recordingTimer = undefined; return; }
    if (entry.recordingCaptureInFlight) return;
    entry.recordingCaptureInFlight = true;
    try {
      const { path } = await this.capture(entry);
      entry.evidence.recordings.push(path);
    } catch (error) {
      if (entry.recordingTimer) clearInterval(entry.recordingTimer);
      entry.recordingTimer = undefined;
      appendCapped(entry.evidence.errors, redact(error instanceof Error ? error.message : 'Unable to capture browser recording frame.'), MAX_ERROR_ENTRIES);
    } finally {
      entry.recordingCaptureInFlight = false;
    }
  }
  private async capture(entry: BrowserEntry): Promise<{ path: string; bytes: Buffer }> { const image = await entry.window.webContents.capturePage(); const directory = desktopDataPath('browser-evidence'); await mkdir(directory, { recursive: true }); const path = `${directory}/${entry.evidence.id}-${Date.now()}.png`; const bytes = image.toPNG(); await writeFile(path, bytes); return { path, bytes }; }
}

function parseHttpUrl(value: string): URL { const parsed = new URL(value); if (!isHttpUrl(parsed.toString())) throw new Error('Browser navigation only supports HTTP(S) URLs.'); return parsed; }
function isHttpUrl(value: string): boolean { try { const protocol = new URL(value).protocol; return protocol === 'http:' || protocol === 'https:'; } catch { return false; } }
function consoleLevel(level: number): string { return ['log', 'warning', 'error', 'debug', 'info'][level] ?? 'log'; }
function redact(value: string): string { return value.replace(/Bearer\s+[^\s]+/giu, 'Bearer [REDACTED]').replace(/sk-[A-Za-z0-9_-]{8,}/gu, '[REDACTED]').slice(0, 4_096); }
function cloneEvidence(value: BrowserEvidence): BrowserEvidence { return { ...value, console: [...value.console], errors: [...value.errors], screenshots: [...value.screenshots], recordings: [...value.recordings] }; }
function appendCapped<T>(items: T[], value: T, limit: number): void { items.push(value); if (items.length > limit) items.splice(0, items.length - limit); }
