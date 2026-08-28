import { BrowserWindow, session, WebContentsView, type Session, type WebContents } from 'electron';
import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import type { BrowserEvidence, BrowserSessionSnapshot, BrowserTabSnapshot, BrowserViewBounds } from '../../contracts/ipc/v1/workspace.js';
import { desktopDataPath } from '../persistence/app-data-paths.js';

export interface BrowserConsoleEntry { level: string; message: string; timestamp: string; }
export interface BrowserScreenshot { evidenceId: string; path: string; dataUrl: string; }
export type BrowserTarget =
  | { type: 'accessibility'; role?: string; name?: string }
  | { type: 'text'; value: string }
  | { type: 'css'; selector: string }
  | { type: 'coordinates'; x: number; y: number };
export interface BrowserPageState {
  tab: BrowserTabSnapshot;
  visibleText: string;
  elements: Array<{ role: string; name: string; tag: string; type?: string; disabled: boolean }>;
}
export interface BrowserInteractionResult { found: boolean; description: string; tag?: string; name?: string; value?: string; checked?: boolean; }
export type BrowserWaitCondition = { type: 'selector' | 'text' | 'url'; value: string };
type BrowserTabEntry = { view: WebContentsView; snapshot: BrowserTabSnapshot };
type BrowserSessionEntry = { id: string; browserSession: Session; tabs: Map<string, BrowserTabEntry>; activeTabId: string; evidence: BrowserEvidence; createdAt: string; recordingTimer: ReturnType<typeof setInterval> | undefined; recordingCaptureInFlight: boolean };
type BrowserStateListener = (snapshot: BrowserSessionSnapshot) => void;

const MAX_CONSOLE_ENTRIES = 200;
const MAX_ERROR_ENTRIES = 100;
const MAX_RECORDING_FRAMES = 30;
const EMPTY_BOUNDS: BrowserViewBounds = { x: 0, y: 0, width: 0, height: 0 };

export class BrowserService {
  private readonly sessions = new Map<string, BrowserSessionEntry>();
  private readonly listeners = new Set<BrowserStateListener>();
  private hostWindow: BrowserWindow | undefined;

  constructor(private readonly onStateChange?: BrowserStateListener) {}

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

  async create(): Promise<BrowserSessionSnapshot> {
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    const entry: BrowserSessionEntry = { id, browserSession: session.fromPartition(`persist:lotagate-browser-${id}`), tabs: new Map(), activeTabId: '', evidence: { id, url: '', title: '', console: [], errors: [], screenshots: [], recordings: [], createdAt }, createdAt, recordingTimer: undefined, recordingCaptureInFlight: false };
    this.sessions.set(id, entry);
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
    for (const tab of entry.tabs.values()) this.destroyTab(tab.view);
    entry.tabs.clear();
    this.sessions.delete(sessionId);
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
    const page = await tab.view.webContents.executeJavaScript(`(() => {
      const visibleText = (document.body?.innerText ?? '').slice(0, 20000);
      const elements = Array.from(document.querySelectorAll('a,button,input,textarea,select,[role]')).slice(0, 200).map((element) => {
        const html = element as HTMLElement;
        const input = element as HTMLInputElement;
        const role = element.getAttribute('role') || element.tagName.toLowerCase();
        const name = element.getAttribute('aria-label') || element.getAttribute('name') || element.getAttribute('placeholder') || (html.innerText || element.textContent || '').trim().replace(/\\s+/gu, ' ').slice(0, 256);
        return { role, name, tag: element.tagName.toLowerCase(), ...(input.type ? { type: input.type } : {}), disabled: Boolean((element as HTMLButtonElement).disabled) };
      });
      return { visibleText, elements };
    })()`, true) as unknown;
    const value = isPageInspection(page) ? page : { visibleText: '', elements: [] };
    return { tab: { ...tab.snapshot }, visibleText: value.visibleText, elements: value.elements };
  }

  async click(sessionId: string, tabId: string | undefined, target: BrowserTarget): Promise<BrowserInteractionResult> {
    const entry = this.require(sessionId);
    const tab = this.requireTab(entry, tabId ?? entry.activeTabId);
    return this.executeTargetAction(tab.view.webContents, target, 'click');
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
    const startedAt = Date.now();
    while (Date.now() - startedAt <= timeout) {
      const found = await tab.view.webContents.executeJavaScript(`(() => {
        const condition = ${JSON.stringify(condition)};
        if (condition.type === 'url') return window.location.href.includes(condition.value);
        if (condition.type === 'text') return (document.body?.innerText ?? '').includes(condition.value);
        return document.querySelector(condition.value) !== null;
      })()`, true) as unknown;
      if (found === true) return { found: true, description: `Wait condition ${condition.type} matched.` };
      await delay(100);
    }
    return { found: false, description: `Timed out waiting for ${condition.type}.` };
  }

  async type(sessionId: string, tabId: string | undefined, target: BrowserTarget, value: string): Promise<BrowserInteractionResult> {
    if (value.length > 64 * 1024) throw new Error('Browser text input exceeds the supported size limit.');
    const entry = this.require(sessionId);
    const tab = this.requireTab(entry, tabId ?? entry.activeTabId);
    return this.executeTargetAction(tab.view.webContents, target, 'type', value);
  }

  async press(sessionId: string, tabId: string | undefined, key: string, modifiers: string[] = []): Promise<BrowserInteractionResult> {
    if (!/^[A-Za-z0-9 _-]{1,32}$/u.test(key)) throw new Error('Browser key is invalid.');
    const allowedModifiers = new Set(['Alt', 'Control', 'Shift', 'Meta']);
    if (modifiers.some(modifier => !allowedModifiers.has(modifier))) throw new Error('Browser key modifiers are invalid.');
    const entry = this.require(sessionId);
    const tab = this.requireTab(entry, tabId ?? entry.activeTabId);
    const contents = tab.view.webContents;
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
    const tab: BrowserTabEntry = { view, snapshot };
    entry.tabs.set(id, tab);
    this.hostWindow?.contentView.addChildView(view);
    this.configureTab(entry, tab);
    view.setVisible(false);
    view.setBounds(EMPTY_BOUNDS);
    await view.webContents.loadURL('about:blank');
    return tab;
  }

  private configureTab(entry: BrowserSessionEntry, tab: BrowserTabEntry): void {
    const contents = tab.view.webContents;
    contents.on('will-navigate', (event, destination) => { if (!isHttpUrl(destination) && destination !== 'about:blank') event.preventDefault(); });
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
      entry.browserSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
      entry.browserSession.setPermissionCheckHandler(() => false);
      entry.browserSession.on('will-download', (_event, item) => { item.cancel(); appendCapped(entry.evidence.errors, 'Downloads require an explicit approved desktop download action.', MAX_ERROR_ENTRIES); this.emit(entry); });
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
    return this.executeTargetAction(tab.view.webContents, target, action, value);
  }

  private async executeTargetAction(contents: WebContents, target: BrowserTarget, action: 'click' | 'type' | 'focus' | 'clear' | 'hover' | 'check' | 'select' | 'read', value?: string): Promise<BrowserInteractionResult> {
    const serializedTarget = JSON.stringify(target).replace(/\u2028/gu, '\\u2028').replace(/\u2029/gu, '\\u2029');
    const serializedValue = JSON.stringify(value ?? '').replace(/\u2028/gu, '\\u2028').replace(/\u2029/gu, '\\u2029');
    const result = await contents.executeJavaScript(`(() => {
      const target = ${serializedTarget};
      const value = ${serializedValue};
      const candidates = Array.from(document.querySelectorAll('a,button,input,textarea,select,[role]'));
      const normalized = (input) => (input || '').trim().replace(/\\s+/gu, ' ').toLowerCase();
      const nameOf = (element) => normalized(element.getAttribute('aria-label') || element.getAttribute('name') || element.getAttribute('placeholder') || element.innerText || element.textContent);
      let element;
      if (target.type === 'css') element = document.querySelector(target.selector);
      else if (target.type === 'coordinates') element = document.elementFromPoint(target.x, target.y);
      else if (target.type === 'text') element = candidates.find((candidate) => nameOf(candidate) === normalized(target.value) || nameOf(candidate).includes(normalized(target.value)));
      else if (target.type === 'accessibility') element = candidates.find((candidate) => (!target.role || (candidate.getAttribute('role') || candidate.tagName.toLowerCase()) === target.role) && (!target.name || nameOf(candidate) === normalized(target.name) || nameOf(candidate).includes(normalized(target.name))));
      if (!(element instanceof HTMLElement)) return { found: false, description: 'The requested browser element was not found.' };
      element.scrollIntoView({ block: 'center', inline: 'center' });
      const tag = element.tagName.toLowerCase();
      const name = element.getAttribute('aria-label') || element.getAttribute('name') || element.getAttribute('placeholder') || (element.innerText || element.textContent || '').trim().replace(/\\s+/gu, ' ').slice(0, 256);
      if (action === 'focus') {
        element.focus();
        return { found: true, description: 'Focused ' + tag + (name ? ' (' + name + ')' : '') + '.', tag, name };
      }
      if (action === 'hover') {
        element.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, view: window }));
        element.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, view: window }));
        return { found: true, description: 'Hovered ' + tag + (name ? ' (' + name + ')' : '') + '.', tag, name };
      }
      if (action === 'read') {
        if (element instanceof HTMLInputElement && element.type.toLowerCase() === 'password') return { found: false, description: 'Reading password fields is blocked.', tag, name };
        const field = element as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
        return { found: true, description: 'Read ' + tag + (name ? ' (' + name + ')' : '') + '.', tag, name, ...(typeof field.value === 'string' ? { value: field.value.slice(0, 4096) } : {}) };
      }
      if (action === 'clear') {
        if (element.matches(':disabled,[readonly]')) return { found: false, description: 'The requested browser field is disabled or read-only.', tag, name };
        const input = element as HTMLInputElement | HTMLTextAreaElement;
        const prototype = Object.getPrototypeOf(input);
        const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
        if (descriptor?.set) descriptor.set.call(input, ''); else input.value = '';
        element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
        return { found: true, description: 'Cleared ' + tag + (name ? ' (' + name + ')' : '') + '.', tag, name };
      }
      if (action === 'check') {
        const input = element as HTMLInputElement;
        if (input.type !== 'checkbox' && input.type !== 'radio') return { found: false, description: 'The requested element is not a checkbox or radio input.', tag, name };
        const checked = value === 'true';
        input.checked = checked;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        return { found: true, description: (checked ? 'Checked ' : 'Unchecked ') + tag + (name ? ' (' + name + ')' : '') + '.', tag, name, checked };
      }
      if (action === 'select') {
        if (!(element instanceof HTMLSelectElement)) return { found: false, description: 'The requested element is not a select input.', tag, name };
        if (![...element.options].some(option => option.value === value || option.textContent?.trim() === value)) return { found: false, description: 'The requested select option was not found.', tag, name };
        const option = [...element.options].find(candidate => candidate.value === value || candidate.textContent?.trim() === value);
        element.value = option?.value ?? value ?? '';
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
        return { found: true, description: 'Selected an option in ' + tag + (name ? ' (' + name + ')' : '') + '.', tag, name, value: element.value };
      }
      if (action === 'click') {
        if (element.matches(':disabled,[aria-disabled="true"]')) return { found: false, description: 'The requested browser element is disabled.', tag, name };
        element.click();
        return { found: true, description: 'Clicked ' + tag + (name ? ' (' + name + ')' : '') + '.', tag, name };
      }
      const input = element;
      if (element.matches(':disabled,[readonly]')) return { found: false, description: 'The requested browser field is disabled or read-only.', tag, name };
      element.focus();
      if (element.isContentEditable) element.textContent = value;
      else {
        const prototype = Object.getPrototypeOf(input);
        const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
        if (descriptor?.set) descriptor.set.call(input, value);
        else input.value = value;
      }
      element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
      return { found: true, description: 'Entered text into ' + tag + (name ? ' (' + name + ')' : '') + '.', tag, name };
    })()`, true) as unknown;
    if (!isInteractionResult(result)) throw new Error('Browser returned an invalid interaction result.');
    return result;
  }
}

function parseHttpUrl(value: string): URL { const parsed = new URL(value); if (!isHttpUrl(parsed.toString())) throw new Error('Browser navigation only supports HTTP(S) URLs.'); return parsed; }
function isHttpUrl(value: string): boolean { try { const protocol = new URL(value).protocol; return protocol === 'http:' || protocol === 'https:'; } catch { return false; } }
function normalizeBounds(bounds: BrowserViewBounds): BrowserViewBounds { return { x: Math.max(0, Math.floor(bounds.x)), y: Math.max(0, Math.floor(bounds.y)), width: Math.min(10_000, Math.max(1, Math.floor(bounds.width))), height: Math.min(10_000, Math.max(1, Math.floor(bounds.height))) }; }
function consoleLevel(level: 'info' | 'warning' | 'error' | 'debug'): string { return level; }
function redact(value: string): string { return value.replace(/Bearer\s+[^\s]+/giu, 'Bearer [REDACTED]').replace(/sk-[A-Za-z0-9_-]{8,}/gu, '[REDACTED]').slice(0, 4_096); }
function cloneEvidence(value: BrowserEvidence): BrowserEvidence { return { ...value, console: [...value.console], errors: [...value.errors], screenshots: [...value.screenshots], recordings: [...value.recordings] }; }
function appendCapped<T>(items: T[], value: T, limit: number): void { items.push(value); if (items.length > limit) items.splice(0, items.length - limit); }
function delay(milliseconds: number): Promise<void> { return new Promise(resolve => setTimeout(resolve, milliseconds)); }
function isPageInspection(value: unknown): value is { visibleText: string; elements: Array<{ role: string; name: string; tag: string; type?: string; disabled: boolean }> } {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record['visibleText'] === 'string' && Array.isArray(record['elements']);
}
function isInteractionResult(value: unknown): value is BrowserInteractionResult {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record['found'] === 'boolean' && typeof record['description'] === 'string';
}
