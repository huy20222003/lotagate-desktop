import { BrowserWindow, session, WebContentsView, type Session, type WebContents } from 'electron';
import { mkdir, stat, unlink, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { basename, dirname } from 'node:path';
import type { BrowserSettings } from '../../contracts/ipc/v1/settings.js';
import type { BrowserEvidence, BrowserSessionSnapshot, BrowserTabSnapshot, BrowserViewBounds } from '../../contracts/ipc/v1/workspace.js';
import { desktopDataPath } from '../persistence/app-data-paths.js';
import { accessibilityTree, enableDialogEvents, handleDialog, resetViewport, setViewport, uploadFile, type BrowserAccessibilityNode, type BrowserDialog, type BrowserViewport } from './browser-devtools.js';
import { downloadBrowserResource, type BrowserDownloadState, type BrowserDownloadResult } from './browser-downloads.js';
import { appendCapped, assertOriginAllowed, cloneEvidence, consoleLevel, defaultBrowserSettings, isAllowedOrigin, isHttpUrl, normalizeBounds, parseHttpUrl, pruneEvidenceFiles, redact, safeUrl, viewportForSettings } from './browser-service-support.js';
import { dragBrowserTarget, executeBrowserTargetAction, extractBrowserTable, inspectBrowserElement, inspectBrowserPage, listBrowserFrames, waitForBrowserCondition } from './browser-page-operations.js';
import { EMPTY_BOUNDS, MAX_CONSOLE_ENTRIES, MAX_ERROR_ENTRIES, MAX_NETWORK_ENTRIES, MAX_RECORDING_FRAMES, MAX_UPLOAD_BYTES, PERSISTENT_BROWSER_PARTITION } from './browser-constants.js';
import type { BrowserConsoleEntry, BrowserElementInspection, BrowserFrameSnapshot, BrowserInteractionResult, BrowserPageState, BrowserPdfOptions, BrowserScreenshot, BrowserTableSnapshot, BrowserTarget, BrowserWaitCondition } from './browser-types.js';
export type { BrowserConsoleEntry, BrowserElementInspection, BrowserFrameSnapshot, BrowserInteractionResult, BrowserPageState, BrowserPdfOptions, BrowserScreenshot, BrowserTableSnapshot, BrowserTarget, BrowserWaitCondition } from './browser-types.js';
export interface BrowserConsoleSnapshot { tab: BrowserTabSnapshot; console: BrowserConsoleEntry[]; errors: string[]; }
export interface BrowserNetworkEntry { tabId: string; method: string; url: string; resourceType: string; statusCode?: number; fromCache?: boolean; error?: string; timestamp: string; }
export interface BrowserAccessibilitySnapshot { tab: BrowserTabSnapshot; nodes: BrowserAccessibilityNode[]; }
type BrowserTabEntry = { view: WebContentsView; snapshot: BrowserTabSnapshot; viewport: BrowserViewport | undefined };
type BrowserDownloadListener = (event: Electron.Event, item: Electron.DownloadItem) => void;
type BrowserSessionEntry = { id: string; browserSession: Session; settings: BrowserSettings; tabs: Map<string, BrowserTabEntry>; activeTabId: string; evidence: BrowserEvidence; network: BrowserNetworkEntry[]; dialogs: Map<string, BrowserDialog>; downloadState: BrowserDownloadState; createdAt: string; recordingTimer: ReturnType<typeof setInterval> | undefined; retentionTimer: ReturnType<typeof setTimeout> | undefined; recordingCaptureInFlight: boolean; downloadListener?: BrowserDownloadListener };
type BrowserStateListener = (snapshot: BrowserSessionSnapshot) => void;

export class BrowserService {
  private readonly sessions = new Map<string, BrowserSessionEntry>();
  private readonly listeners = new Set<BrowserStateListener>();
  private hostWindow: BrowserWindow | undefined;

  constructor(private readonly onStateChange?: BrowserStateListener, private readonly getSettings: () => Promise<BrowserSettings> = async () => defaultBrowserSettings()) {}

  attachWindow(window: BrowserWindow): void {
    if (this.hostWindow === window) return;
    this.hostWindow = window;
    for (const entry of this.sessions.values()) for (const tab of entry.tabs.values()) window.contentView.addChildView(tab.view);
    window.on('closed', () => {
      if (this.hostWindow !== window) return;
      this.hostWindow = undefined;
      for (const entry of this.sessions.values()) for (const tab of entry.tabs.values()) tab.view.setVisible(false);
    });
  }

  onState(listener: BrowserStateListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async create(profileKey = 'default'): Promise<BrowserSessionSnapshot> {
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    const settings = await this.getSettings();
    await pruneEvidenceFiles(settings.evidenceRetentionDays);
    const stableProfile = createHash('sha256').update(profileKey).digest('hex').slice(0, 32);
    const partition = settings.sessionRetention === 'session' ? `lotagate-browser-${id}` : `${PERSISTENT_BROWSER_PARTITION}-${stableProfile}`;
    const entry: BrowserSessionEntry = { id, browserSession: session.fromPartition(partition), settings, tabs: new Map(), activeTabId: '', evidence: { id, url: '', title: '', console: [], errors: [], screenshots: [], recordings: [], createdAt }, network: [], dialogs: new Map(), downloadState: { pending: undefined }, createdAt, recordingTimer: undefined, retentionTimer: undefined, recordingCaptureInFlight: false };
    this.sessions.set(id, entry);
    if (settings.sessionRetention === 'ttl') entry.retentionTimer = setTimeout(() => { void this.close(id); }, settings.sessionRetentionMinutes * 60 * 1_000);
    try {
      const tab = await this.createTabEntry(entry);
      entry.activeTabId = tab.snapshot.id;
      this.applyTabVisibility(entry);
      this.emit(entry);
      return this.snapshot(entry);
    } catch (error) {
      await this.close(id);
      throw error;
    }
  }

  async open(url: string, approved: boolean): Promise<{ id: string; url: string }> {
    if (!approved) throw new Error('Browser navigation requires explicit approval.');
    const parsed = parseHttpUrl(url);
    const sessionSnapshot = await this.create();
    try {
      await this.navigate(sessionSnapshot.id, sessionSnapshot.activeTabId, parsed.toString(), true);
      return { id: sessionSnapshot.id, url: parsed.toString() };
    } catch (error) {
      await this.close(sessionSnapshot.id);
      throw error;
    }
  }

  async close(sessionId: string): Promise<void> {
    const entry = this.sessions.get(sessionId);
    if (entry === undefined) return;
    if (entry.recordingTimer) clearInterval(entry.recordingTimer);
    if (entry.retentionTimer) clearTimeout(entry.retentionTimer);
    if (entry.downloadState.pending !== undefined) { clearTimeout(entry.downloadState.pending.timer); entry.downloadState.pending.reject(new Error('Browser session closed before the download completed.')); entry.downloadState.pending = undefined; }
    if (entry.downloadListener !== undefined) entry.browserSession.removeListener('will-download', entry.downloadListener);
    if (entry.settings.clearDataOnClose || entry.settings.sessionRetention === 'ttl') {
      await entry.browserSession.clearStorageData().catch(() => undefined);
      await Promise.all([...entry.evidence.screenshots, ...entry.evidence.recordings].map(path => unlink(path).catch(() => undefined)));
    }
    for (const tab of entry.tabs.values()) this.destroyTab(tab.view);
    entry.tabs.clear();
    this.sessions.delete(sessionId);
  }

  hide(sessionId: string): void {
    const entry = this.sessions.get(sessionId);
    if (entry === undefined) return;
    for (const tab of entry.tabs.values()) {
      tab.view.setVisible(false);
      tab.view.setBounds(EMPTY_BOUNDS);
    }
  }

  async createTab(sessionId: string): Promise<BrowserTabSnapshot> {
    const entry = this.require(sessionId);
    const tab = await this.createTabEntry(entry);
    entry.activeTabId = tab.snapshot.id;
    this.applyTabVisibility(entry);
    this.emit(entry);
    return { ...tab.snapshot };
  }

  async closeTab(sessionId: string, tabId: string): Promise<void> {
    const entry = this.require(sessionId);
    if (entry.tabs.size <= 1) throw new Error('A browser session must keep one tab open.');
    const tab = this.requireTab(entry, tabId);
    const tabIds = [...entry.tabs.keys()];
    const index = tabIds.indexOf(tabId);
    this.destroyTab(tab.view);
    entry.tabs.delete(tabId);
    if (entry.activeTabId === tabId) entry.activeTabId = tabIds[index + 1] ?? tabIds[index - 1] ?? tabIds[0]!;
    this.applyTabVisibility(entry);
    this.emit(entry);
  }

  async selectTab(sessionId: string, tabId: string): Promise<BrowserSessionSnapshot> {
    const entry = this.require(sessionId);
    this.requireTab(entry, tabId);
    entry.activeTabId = tabId;
    this.updateEvidence(entry, this.requireTab(entry, tabId));
    this.applyTabVisibility(entry);
    this.emit(entry);
    return this.snapshot(entry);
  }

  async navigate(sessionId: string, tabId: string, url: string, approved: boolean): Promise<BrowserTabSnapshot> {
    if (!approved) throw new Error('Browser navigation requires explicit approval.');
    const parsed = parseHttpUrl(url);
    const entry = this.require(sessionId);
    assertOriginAllowed(parsed, entry.settings.originAllowlist);
    const tab = this.requireTab(entry, tabId);
    tab.snapshot.loading = true;
    this.emit(entry);
    await tab.view.webContents.loadURL(parsed.toString());
    tab.snapshot.loading = false;
    tab.snapshot.url = tab.view.webContents.getURL() || parsed.toString();
    tab.snapshot.title = await tab.view.webContents.getTitle();
    this.updateEvidence(entry, tab);
    this.emit(entry);
    return { ...tab.snapshot };
  }

  async goBack(sessionId: string, tabId: string): Promise<BrowserTabSnapshot> { return this.navigateHistory(sessionId, tabId, 'back'); }
  async goForward(sessionId: string, tabId: string): Promise<BrowserTabSnapshot> { return this.navigateHistory(sessionId, tabId, 'forward'); }

  async reload(sessionId: string, tabId: string): Promise<BrowserTabSnapshot> {
    const entry = this.require(sessionId);
    const tab = this.requireTab(entry, tabId);
    tab.snapshot.loading = true;
    this.emit(entry);
    await tab.view.webContents.reload();
    tab.snapshot.loading = false;
    tab.snapshot.url = tab.view.webContents.getURL();
    tab.snapshot.title = await tab.view.webContents.getTitle();
    this.updateEvidence(entry, tab);
    this.emit(entry);
    return { ...tab.snapshot };
  }

  setViewBounds(sessionId: string, tabId: string, bounds: BrowserViewBounds, visible: boolean): void {
    // Layout updates are best-effort. A renderer resize callback can arrive
    // after the browser drawer or its session has already been closed.
    const entry = this.sessions.get(sessionId);
    if (entry === undefined) return;
    const tab = entry.tabs.get(tabId);
    if (tab === undefined) return;
    const isVisible = visible && entry.activeTabId === tabId && tab.snapshot.url !== 'about:blank' && bounds.width > 0 && bounds.height > 0 && this.hostWindow !== undefined;
    tab.view.setVisible(isVisible);
    tab.view.setBounds(isVisible ? normalizeBounds(bounds) : EMPTY_BOUNDS);
  }

  async screenshot(sessionId: string, tabId?: string): Promise<BrowserScreenshot> {
    const entry = this.require(sessionId);
    const tab = this.requireTab(entry, tabId ?? entry.activeTabId);
    const { path, bytes } = await this.capture(entry, tab.view.webContents);
    entry.evidence.screenshots.push(path);
    this.emit(entry);
    return { evidenceId: sessionId, path, dataUrl: `data:image/png;base64,${bytes.toString('base64')}` };
  }

  async startRecording(sessionId: string): Promise<void> {
    const entry = this.require(sessionId);
    if (entry.recordingTimer) return;
    await this.captureRecordingFrame(entry);
    entry.recordingTimer = setInterval(() => { void this.captureRecordingFrame(entry); }, 2_000);
  }

  async stopRecording(sessionId: string): Promise<BrowserEvidence> {
    const entry = this.require(sessionId);
    if (entry.recordingTimer) clearInterval(entry.recordingTimer);
    entry.recordingTimer = undefined;
    await this.captureRecordingFrame(entry);
    return cloneEvidence(entry.evidence);
  }

  list(): BrowserSessionSnapshot[] { return [...this.sessions.values()].map(entry => this.snapshot(entry)); }
  get(sessionId: string): BrowserSessionSnapshot { return this.snapshot(this.require(sessionId)); }
  evidence(sessionId: string): BrowserEvidence { return cloneEvidence(this.require(sessionId).evidence); }
  async closeAll(): Promise<void> { for (const id of [...this.sessions.keys()]) await this.close(id); }

  async inspect(sessionId: string, tabId?: string): Promise<BrowserPageState> {
    const entry = this.require(sessionId);
    const tab = this.requireTab(entry, tabId ?? entry.activeTabId);
    return { tab: { ...tab.snapshot }, ...(await inspectBrowserPage(tab.view.webContents)) };
  }

  async inspectElement(sessionId: string, tabId: string | undefined, target: BrowserTarget): Promise<BrowserElementInspection> {
    const entry = this.require(sessionId);
    const tab = this.requireTab(entry, tabId ?? entry.activeTabId);
    return inspectBrowserElement(tab.view.webContents, target);
  }

  async extractTable(sessionId: string, tabId: string | undefined, target: BrowserTarget, maxRows = 100): Promise<BrowserTableSnapshot> {
    const entry = this.require(sessionId);
    const tab = this.requireTab(entry, tabId ?? entry.activeTabId);
    return extractBrowserTable(tab.view.webContents, target, maxRows);
  }

  async drag(sessionId: string, tabId: string | undefined, from: BrowserTarget, to: BrowserTarget): Promise<BrowserInteractionResult> {
    const entry = this.require(sessionId);
    const tab = this.requireTab(entry, tabId ?? entry.activeTabId);
    return dragBrowserTarget(tab.view.webContents, from, to);
  }

  async listFrames(sessionId: string, tabId?: string): Promise<BrowserFrameSnapshot[]> {
    const entry = this.require(sessionId);
    const tab = this.requireTab(entry, tabId ?? entry.activeTabId);
    return listBrowserFrames(tab.view.webContents);
  }

  async exportPdf(sessionId: string, tabId: string | undefined, outputPath: string, options: BrowserPdfOptions): Promise<{ path: string; sizeBytes: number; tab: BrowserTabSnapshot }> {
    const entry = this.require(sessionId);
    const tab = this.requireTab(entry, tabId ?? entry.activeTabId);
    const pdf = await tab.view.webContents.printToPDF({ printBackground: options.printBackground, landscape: options.landscape, pageSize: options.pageSize });
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, pdf, { flag: options.overwrite ? 'w' : 'wx' });
    return { path: outputPath, sizeBytes: pdf.byteLength, tab: { ...tab.snapshot } };
  }

  console(sessionId: string, tabId?: string, limit = 100): BrowserConsoleSnapshot {
    const entry = this.require(sessionId);
    const tab = this.requireTab(entry, tabId ?? entry.activeTabId);
    return { tab: { ...tab.snapshot }, console: entry.evidence.console.slice(-limit), errors: entry.evidence.errors.slice(-limit) };
  }

  network(sessionId: string, tabId?: string, limit = 100): { tab: BrowserTabSnapshot; requests: BrowserNetworkEntry[] } {
    const entry = this.require(sessionId);
    const tab = this.requireTab(entry, tabId ?? entry.activeTabId);
    return { tab: { ...tab.snapshot }, requests: entry.network.filter(item => item.tabId === tab.snapshot.id).slice(-limit) };
  }

  async accessibility(sessionId: string, tabId?: string): Promise<BrowserAccessibilitySnapshot> {
    const entry = this.require(sessionId);
    const tab = this.requireTab(entry, tabId ?? entry.activeTabId);
    return { tab: { ...tab.snapshot }, nodes: await accessibilityTree(tab.view.webContents) };
  }

  async setResponsiveViewport(sessionId: string, tabId: string | undefined, viewport: BrowserViewport): Promise<{ tab: BrowserTabSnapshot; viewport: BrowserViewport }> {
    const entry = this.require(sessionId);
    const tab = this.requireTab(entry, tabId ?? entry.activeTabId);
    await setViewport(tab.view.webContents, viewport);
    tab.viewport = { ...viewport };
    return { tab: { ...tab.snapshot }, viewport: { ...viewport } };
  }

  async resetResponsiveViewport(sessionId: string, tabId?: string): Promise<{ tab: BrowserTabSnapshot; viewport: null }> {
    const entry = this.require(sessionId);
    const tab = this.requireTab(entry, tabId ?? entry.activeTabId);
    await resetViewport(tab.view.webContents);
    tab.viewport = undefined;
    return { tab: { ...tab.snapshot }, viewport: null };
  }

  async upload(sessionId: string, tabId: string | undefined, selector: string, filePath: string): Promise<BrowserInteractionResult> {
    const entry = this.require(sessionId);
    const tab = this.requireTab(entry, tabId ?? entry.activeTabId);
    const details = await stat(filePath);
    if (!details.isFile()) throw new Error('The browser upload path must be a file.');
    if (details.size <= 0 || details.size > MAX_UPLOAD_BYTES) throw new Error('The browser upload file exceeds the 25 MB limit.');
    await uploadFile(tab.view.webContents, selector, filePath);
    return { found: true, description: `Uploaded ${basename(filePath)} to the browser file input.` };
  }

  async download(sessionId: string, tabId: string | undefined, url: string): Promise<BrowserDownloadResult> { const entry = this.require(sessionId); const parsed = parseHttpUrl(url); assertOriginAllowed(parsed, entry.settings.originAllowlist); const tab = this.requireTab(entry, tabId ?? entry.activeTabId); return downloadBrowserResource(entry.downloadState, tab.view.webContents, parsed.toString(), entry.settings.downloadDirectory); }

  async dialog(sessionId: string, tabId: string | undefined, action: 'read' | 'accept' | 'dismiss', promptText?: string): Promise<BrowserDialog | { found: boolean; description: string }> {
    const entry = this.require(sessionId);
    const tab = this.requireTab(entry, tabId ?? entry.activeTabId);
    const active = entry.dialogs.get(tab.snapshot.id);
    if (action === 'read') return active === undefined ? { found: false, description: 'No browser dialog is currently open.' } : { ...active };
    if (active === undefined) throw new Error('No browser dialog is currently open.');
    await handleDialog(tab.view.webContents, action === 'accept', promptText);
    entry.dialogs.delete(tab.snapshot.id);
    return { found: true, description: action === 'accept' ? 'Accepted the browser dialog.' : 'Dismissed the browser dialog.' };
  }

  async click(sessionId: string, tabId: string | undefined, target: BrowserTarget): Promise<BrowserInteractionResult> {
    const entry = this.require(sessionId);
    const tab = this.requireTab(entry, tabId ?? entry.activeTabId);
    return executeBrowserTargetAction(tab.view.webContents, target, 'click');
  }

  async focus(sessionId: string, tabId: string | undefined, target: BrowserTarget): Promise<BrowserInteractionResult> { return this.targetAction(sessionId, tabId, target, 'focus'); }
  async clear(sessionId: string, tabId: string | undefined, target: BrowserTarget): Promise<BrowserInteractionResult> { return this.targetAction(sessionId, tabId, target, 'clear'); }
  async hover(sessionId: string, tabId: string | undefined, target: BrowserTarget): Promise<BrowserInteractionResult> { return this.targetAction(sessionId, tabId, target, 'hover'); }
  async check(sessionId: string, tabId: string | undefined, target: BrowserTarget, checked: boolean): Promise<BrowserInteractionResult> { return this.targetAction(sessionId, tabId, target, 'check', String(checked)); }
  async selectOption(sessionId: string, tabId: string | undefined, target: BrowserTarget, value: string): Promise<BrowserInteractionResult> { return this.targetAction(sessionId, tabId, target, 'select', value); }
  async readField(sessionId: string, tabId: string | undefined, target: BrowserTarget): Promise<BrowserInteractionResult> { return this.targetAction(sessionId, tabId, target, 'read'); }

  async waitFor(sessionId: string, tabId: string | undefined, condition: BrowserWaitCondition, timeoutMs = 15_000): Promise<BrowserInteractionResult> {
    if (condition.value.length === 0 || condition.value.length > 4_096) throw new Error('Browser wait condition is invalid.');
    const timeout = Math.min(30_000, Math.max(250, Math.floor(timeoutMs)));
    const entry = this.require(sessionId);
    const tab = this.requireTab(entry, tabId ?? entry.activeTabId);
    return waitForBrowserCondition(tab.view.webContents, condition, timeout);
  }

  async type(sessionId: string, tabId: string | undefined, target: BrowserTarget, value: string): Promise<BrowserInteractionResult> {
    if (value.length > 64 * 1024) throw new Error('Browser text input exceeds the supported size limit.');
    const entry = this.require(sessionId);
    const tab = this.requireTab(entry, tabId ?? entry.activeTabId);
    return executeBrowserTargetAction(tab.view.webContents, target, 'type', value);
  }

  async press(sessionId: string, tabId: string | undefined, key: string, modifiers: string[] = []): Promise<BrowserInteractionResult> {
    if (!/^[A-Za-z0-9 _-]{1,32}$/u.test(key)) throw new Error('Browser key is invalid.');
    const allowedModifiers = new Set(['Alt', 'Control', 'Shift', 'Meta']);
    if (modifiers.some(modifier => !allowedModifiers.has(modifier))) throw new Error('Browser key modifiers are invalid.');
    const entry = this.require(sessionId);
    const tab = this.requireTab(entry, tabId ?? entry.activeTabId);
    const contents = tab.view.webContents;
    void enableDialogEvents(contents, dialog => { entry.dialogs.set(tab.snapshot.id, dialog); this.emit(entry); });
    for (const modifier of modifiers) contents.sendInputEvent({ type: 'keyDown', keyCode: modifier });
    contents.sendInputEvent({ type: 'keyDown', keyCode: key });
    contents.sendInputEvent({ type: 'keyUp', keyCode: key });
    for (const modifier of [...modifiers].reverse()) contents.sendInputEvent({ type: 'keyUp', keyCode: modifier });
    return { found: true, description: `Pressed ${modifiers.length > 0 ? `${modifiers.join('+')}+` : ''}${key}.` };
  }

  async scroll(sessionId: string, tabId: string | undefined, deltaX: number, deltaY: number): Promise<BrowserInteractionResult> {
    if (!Number.isFinite(deltaX) || !Number.isFinite(deltaY) || Math.abs(deltaX) > 10_000 || Math.abs(deltaY) > 10_000) throw new Error('Browser scroll delta is invalid.');
    const entry = this.require(sessionId);
    const tab = this.requireTab(entry, tabId ?? entry.activeTabId);
    await tab.view.webContents.executeJavaScript(`window.scrollBy(${JSON.stringify(Math.trunc(deltaX))}, ${JSON.stringify(Math.trunc(deltaY))})`, true);
    return { found: true, description: `Scrolled by ${Math.trunc(deltaX)}, ${Math.trunc(deltaY)}.` };
  }

  private async createTabEntry(entry: BrowserSessionEntry): Promise<BrowserTabEntry> {
    const id = randomUUID();
    const view = new WebContentsView({ webPreferences: { session: entry.browserSession, nodeIntegration: false, contextIsolation: true, sandbox: true } });
    const snapshot: BrowserTabSnapshot = { id, title: 'New tab', url: 'about:blank', loading: false, canGoBack: false, canGoForward: false };
    const tab: BrowserTabEntry = { view, snapshot, viewport: undefined };
    entry.tabs.set(id, tab);
    this.hostWindow?.contentView.addChildView(view);
    this.configureTab(entry, tab);
    view.setVisible(false);
    view.setBounds(EMPTY_BOUNDS);
    await view.webContents.loadURL('about:blank');
    const viewport = viewportForSettings(entry.settings);
    if (viewport !== undefined) { await setViewport(view.webContents, viewport); tab.viewport = viewport; }
    return tab;
  }

  private configureTab(entry: BrowserSessionEntry, tab: BrowserTabEntry): void {
    const contents = tab.view.webContents;
    const blockDisallowedNavigation = (event: Electron.Event, destination: string): void => {
      if ((!isHttpUrl(destination) && destination !== 'about:blank') || !isAllowedOrigin(destination, entry.settings.originAllowlist)) event.preventDefault();
    };
    contents.on('will-navigate', blockDisallowedNavigation);
    contents.on('will-redirect', blockDisallowedNavigation);
    contents.setWindowOpenHandler(({ url }) => { appendCapped(entry.evidence.errors, `Blocked popup navigation: ${redact(url)}`, MAX_ERROR_ENTRIES); this.emit(entry); return { action: 'deny' }; });
    contents.on('console-message', details => { appendCapped(entry.evidence.console, { level: consoleLevel(details.level), message: redact(details.message), timestamp: new Date().toISOString() }, MAX_CONSOLE_ENTRIES); this.emit(entry); });
    contents.on('did-start-loading', () => { tab.snapshot.loading = true; this.emit(entry); });
    contents.on('did-stop-loading', () => { tab.snapshot.loading = false; this.refreshTabState(entry, tab); });
    contents.on('did-navigate', (_event, destination) => { tab.snapshot.url = destination; this.refreshTabState(entry, tab); });
    contents.on('did-navigate-in-page', (_event, destination) => { tab.snapshot.url = destination; this.refreshTabState(entry, tab); });
    contents.on('page-title-updated', (_event, title) => { tab.snapshot.title = title || 'New tab'; this.emit(entry); });
    contents.on('did-fail-load', (_event, errorCode, errorDescription) => { tab.snapshot.loading = false; appendCapped(entry.evidence.errors, redact(`${errorCode}: ${errorDescription}`), MAX_ERROR_ENTRIES); this.emit(entry); });
    contents.on('render-process-gone', (_event, details) => { appendCapped(entry.evidence.errors, redact(`Render process ended: ${details.reason}`), MAX_ERROR_ENTRIES); this.emit(entry); });
    if (entry.tabs.size === 1) {
      entry.browserSession.webRequest.onCompleted(details => {
        const owner = [...entry.tabs.values()].find(candidate => candidate.view.webContents.id === details.webContentsId);
        if (owner === undefined) return;
        appendCapped(entry.network, { tabId: owner.snapshot.id, method: details.method, url: safeUrl(details.url), resourceType: details.resourceType, statusCode: details.statusCode, fromCache: details.fromCache, timestamp: new Date().toISOString() }, MAX_NETWORK_ENTRIES);
        this.emit(entry);
      });
      entry.browserSession.webRequest.onErrorOccurred(details => {
        const owner = [...entry.tabs.values()].find(candidate => candidate.view.webContents.id === details.webContentsId);
        if (owner === undefined) return;
        appendCapped(entry.network, { tabId: owner.snapshot.id, method: details.method, url: safeUrl(details.url), resourceType: details.resourceType, error: redact(details.error), timestamp: new Date().toISOString() }, MAX_NETWORK_ENTRIES);
        this.emit(entry);
      });
      entry.browserSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
      entry.browserSession.setPermissionCheckHandler(() => false);
      const onWillDownload: BrowserDownloadListener = (_event, item) => {
        const pending = entry.downloadState.pending;
        if (pending === undefined) { item.cancel(); appendCapped(entry.evidence.errors, 'Downloads require an explicit approved desktop download action.', MAX_ERROR_ENTRIES); this.emit(entry); return; }
        entry.downloadState.pending = undefined;
        clearTimeout(pending.timer);
        item.setSavePath(pending.path);
        item.once('done', (_doneEvent, state) => {
          if (state !== 'completed') { pending.reject(new Error(`Browser download ${state}.`)); return; }
          pending.resolve({ found: true, path: pending.path, filename: item.getFilename(), sizeBytes: item.getReceivedBytes(), description: `Downloaded ${item.getFilename()} to the Desktop downloads folder.` });
        });
      };
      entry.downloadListener = onWillDownload;
      entry.browserSession.on('will-download', onWillDownload);
    }
  }

  private async navigateHistory(sessionId: string, tabId: string, direction: 'back' | 'forward'): Promise<BrowserTabSnapshot> {
    const entry = this.require(sessionId);
    const tab = this.requireTab(entry, tabId);
    const history = tab.view.webContents.navigationHistory;
    if (direction === 'back' && !history.canGoBack()) return { ...tab.snapshot };
    if (direction === 'forward' && !history.canGoForward()) return { ...tab.snapshot };
    if (direction === 'back') history.goBack(); else history.goForward();
    return { ...tab.snapshot };
  }

  private refreshTabState(entry: BrowserSessionEntry, tab: BrowserTabEntry): void {
    tab.snapshot.canGoBack = tab.view.webContents.navigationHistory.canGoBack();
    tab.snapshot.canGoForward = tab.view.webContents.navigationHistory.canGoForward();
    tab.snapshot.url = tab.view.webContents.getURL() || tab.snapshot.url;
    this.updateEvidence(entry, tab);
    this.emit(entry);
  }

  private updateEvidence(entry: BrowserSessionEntry, tab: BrowserTabEntry): void { if (entry.activeTabId === tab.snapshot.id) { entry.evidence.url = tab.snapshot.url; entry.evidence.title = tab.snapshot.title; } }
  private applyTabVisibility(entry: BrowserSessionEntry): void { for (const [id, tab] of entry.tabs) { const visible = id === entry.activeTabId && tab.snapshot.url !== 'about:blank' && this.hostWindow !== undefined; tab.view.setVisible(visible); if (!visible) tab.view.setBounds(EMPTY_BOUNDS); } }
  private emit(entry: BrowserSessionEntry): void { const snapshot = this.snapshot(entry); this.onStateChange?.(snapshot); for (const listener of this.listeners) listener(snapshot); }
  private snapshot(entry: BrowserSessionEntry): BrowserSessionSnapshot { return { id: entry.id, activeTabId: entry.activeTabId, tabs: [...entry.tabs.values()].map(tab => ({ ...tab.snapshot })), createdAt: entry.createdAt }; }
  private require(sessionId: string): BrowserSessionEntry { const entry = this.sessions.get(sessionId); if (entry === undefined) throw new Error('Browser session was not found.'); return entry; }
  private requireTab(entry: BrowserSessionEntry, tabId: string): BrowserTabEntry { const tab = entry.tabs.get(tabId); if (tab === undefined) throw new Error('Browser tab was not found.'); return tab; }
  private destroyTab(view: WebContentsView): void { this.hostWindow?.contentView.removeChildView(view); if (!view.webContents.isDestroyed()) view.webContents.close(); }
  private async captureRecordingFrame(entry: BrowserSessionEntry): Promise<void> {
    if (entry.evidence.recordings.length >= MAX_RECORDING_FRAMES) { if (entry.recordingTimer) clearInterval(entry.recordingTimer); entry.recordingTimer = undefined; return; }
    if (entry.recordingCaptureInFlight) return;
    entry.recordingCaptureInFlight = true;
    try { const tab = this.requireTab(entry, entry.activeTabId); const { path } = await this.capture(entry, tab.view.webContents); entry.evidence.recordings.push(path); this.emit(entry); }
    catch (error) { if (entry.recordingTimer) clearInterval(entry.recordingTimer); entry.recordingTimer = undefined; appendCapped(entry.evidence.errors, redact(error instanceof Error ? error.message : 'Unable to capture browser recording frame.'), MAX_ERROR_ENTRIES); this.emit(entry); }
    finally { entry.recordingCaptureInFlight = false; }
  }
  private async capture(entry: BrowserSessionEntry, contents: WebContents): Promise<{ path: string; bytes: Buffer }> { const image = await contents.capturePage(); const directory = desktopDataPath('browser-evidence'); await mkdir(directory, { recursive: true }); const path = `${directory}/${entry.evidence.id}-${Date.now()}.png`; const bytes = image.toPNG(); await writeFile(path, bytes); return { path, bytes }; }
  private async targetAction(sessionId: string, tabId: string | undefined, target: BrowserTarget, action: 'focus' | 'clear' | 'hover' | 'check' | 'select' | 'read', value?: string): Promise<BrowserInteractionResult> {
    const entry = this.require(sessionId);
    const tab = this.requireTab(entry, tabId ?? entry.activeTabId);
    return executeBrowserTargetAction(tab.view.webContents, target, action, value);
  }

}
