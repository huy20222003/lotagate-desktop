import type { DesktopHostRequest, DesktopHostResponse } from '../../contracts/agent-protocol/v1/desktop.js';
import type { AutomationBrowserAccess } from '../../contracts/ipc/v1/automation.js';
import { BrowserService, type BrowserTarget, type BrowserWaitCondition } from '../browser/browser-service.js';
import { requireExistingPath, requireWorkspaceMutationPath } from '../security/path-policy.js';

export interface BrowserHostActivity {
  event: 'browser.session.created' | 'browser.action.started' | 'browser.action.completed';
  data: Record<string, unknown>;
}

/**
 * Adapts CLI browser tool requests to the Desktop-owned browser runtime.
 * Electron APIs intentionally stop at this boundary; the CLI only knows the
 * versioned host protocol and never receives a WebContentsView reference.
 */
export class BrowserHostToolBroker {
  private readonly sessions = new Map<string, string>();
  private readonly sessionRuns = new Map<string, string>();
  private readonly runSessions = new Map<string, Set<string>>();
  private readonly runPolicies = new Map<string, AutomationBrowserAccess>();
  private readonly serial = new Map<string, Promise<void>>();
  private readonly sessionGenerations = new Map<string, number>();

  constructor(private readonly browser: BrowserService, private readonly onActivity?: (cwd: string, activity: BrowserHostActivity) => void) {}

  setRunPolicy(runId: string, access: AutomationBrowserAccess): void { this.runPolicies.set(runId, access); }
  bindSessionToRun(cwd: string, sessionId: string, runId: string): void { this.sessionRuns.set(`${cwd}\u0000${sessionId}`, runId); }
  clearRunPolicy(runId: string): void {
    this.runPolicies.delete(runId);
    for (const [key, sessionRunId] of this.sessionRuns) if (sessionRunId === runId) this.sessionRuns.delete(key);
  }
  async closeRun(runId: string): Promise<void> {
    const browserSessionIds = new Set(this.runSessions.get(runId) ?? []);
    const keys = new Set<string>();
    for (const [key, mappedRunId] of this.sessionRuns) if (mappedRunId === runId) keys.add(key);
    for (const [key, browserSessionId] of this.sessions) if (browserSessionIds.has(browserSessionId)) keys.add(key);
    const mappedBrowserSessionIds = new Set([...keys].map(key => this.sessions.get(key)).filter((id): id is string => id !== undefined));
    for (const key of keys) await this.closeForKey(key);
    for (const browserSessionId of browserSessionIds) {
      if (mappedBrowserSessionIds.has(browserSessionId)) continue;
      await this.browser.close(browserSessionId);
    }
    this.runSessions.delete(runId);
    this.runPolicies.delete(runId);
    for (const [key, sessionRunId] of this.sessionRuns) if (sessionRunId === runId) this.sessionRuns.delete(key);
  }

  async closeForSession(cwd: string, sessionId: string): Promise<void> {
    await this.closeForKey(`${cwd}\u0000${sessionId}`);
  }

  private async closeForKey(key: string): Promise<void> {
    this.bumpGeneration(key);
    const browserSessionId = this.sessions.get(key);
    this.sessions.delete(key);
    this.sessionRuns.delete(key);
    try {
      if (browserSessionId !== undefined) await this.browser.close(browserSessionId);
    } finally {
      for (const [runId, sessionIds] of this.runSessions) {
        if (browserSessionId !== undefined) sessionIds.delete(browserSessionId);
        if (sessionIds.size === 0) this.runSessions.delete(runId);
      }
      this.cleanupGeneration(key);
    }
  }

  async handle(cwd: string, request: DesktopHostRequest, signal?: AbortSignal): Promise<DesktopHostResponse> {
    const key = `${cwd}\u0000${request.sessionId}`;
    const generation = this.sessionGenerations.get(key) ?? 0;
    const previous = this.serial.get(key) ?? Promise.resolve();
    let active = false;
    const operation = previous.catch(() => undefined).then(async () => {
      this.assertActive(key, generation, signal);
      active = true;
      try {
        return await this.execute(cwd, request, key, generation, signal);
      } finally {
        active = false;
      }
    });
    const barrier = operation.then(() => undefined, () => undefined);
    this.serial.set(key, barrier);
    const onAbort = (): void => { if (active) void this.closeForKey(key).catch(() => undefined); };
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      return await operation;
    } catch (error) {
      return {
        version: 1,
        type: 'host.response',
        requestId: request.requestId,
        tool: request.tool,
        ok: false,
        error: {
          code: 'BROWSER_HOST_ERROR',
          category: 'browser',
          message: error instanceof Error ? error.message : 'Browser action failed.',
          retryable: false,
        },
      };
    } finally {
      signal?.removeEventListener('abort', onAbort);
      if (this.serial.get(key) === barrier) {
        this.serial.delete(key);
        this.cleanupGeneration(key);
      }
    }
  }

  async closeForWorkspace(cwd: string): Promise<void> {
    const prefix = `${cwd}\u0000`;
    const keys = new Set<string>();
    for (const key of this.sessions.keys()) if (key.startsWith(prefix)) keys.add(key);
    for (const key of this.sessionRuns.keys()) if (key.startsWith(prefix)) keys.add(key);
    for (const key of this.serial.keys()) if (key.startsWith(prefix)) keys.add(key);
    for (const key of keys) await this.closeForKey(key);
    for (const key of this.sessionRuns.keys()) if (key.startsWith(prefix)) this.sessionRuns.delete(key);
  }

  private async execute(cwd: string, request: DesktopHostRequest, key: string, generation: number, signal?: AbortSignal): Promise<DesktopHostResponse> {
    this.assertActive(key, generation, signal);
    const policyRunId = this.sessionRuns.get(`${cwd}\u0000${request.sessionId}`) ?? request.runId;
    assertBrowserAccess(request, this.runPolicies.get(policyRunId));
    const browserSessionId = await this.ensureSession(cwd, request, key, generation, signal);
    this.assertActive(key, generation, signal);
    const tabId = optionalId(request.params['tabId']);
    const activeTabId = tabId ?? this.browser.get(browserSessionId).activeTabId;
    this.onActivity?.(cwd, { event: 'browser.action.started', data: { sessionId: request.sessionId, runId: request.runId, browserSessionId, tabId: activeTabId, action: request.action } });
    try {
      const result = await this.runAction(cwd, browserSessionId, activeTabId, request.action, request.params);
      this.assertActive(key, generation, signal);
      this.onActivity?.(cwd, { event: 'browser.action.completed', data: { sessionId: request.sessionId, runId: request.runId, browserSessionId, tabId: activeTabId, action: request.action, success: true } });
      return { version: 1, type: 'host.response', requestId: request.requestId, tool: request.tool, ok: true, result: { browserSessionId, tabId: activeTabId, ...asRecord(result) } };
    } catch (error) {
      this.onActivity?.(cwd, { event: 'browser.action.completed', data: { sessionId: request.sessionId, runId: request.runId, browserSessionId, tabId: activeTabId, action: request.action, success: false } });
      throw error;
    }
  }

  private async ensureSession(cwd: string, request: DesktopHostRequest, key: string, generation: number, signal?: AbortSignal): Promise<string> {
    this.assertActive(key, generation, signal);
    const existing = this.sessions.get(key);
    if (existing !== undefined) return existing;
    // Agent browser profiles must be isolated by the owning CLI session. The
    // human-operated browser keeps its existing default profile separately.
    const snapshot = await this.browser.create(`${cwd}\u0000${request.sessionId}`);
    if ((this.sessionGenerations.get(key) ?? 0) !== generation || signal?.aborted === true) {
      await this.browser.close(snapshot.id).catch(() => undefined);
      throw new Error('Browser action was cancelled.');
    }
    this.sessions.set(key, snapshot.id);
    const policyRunId = this.sessionRuns.get(`${cwd}\u0000${request.sessionId}`) ?? request.runId;
    const runSessions = this.runSessions.get(policyRunId) ?? new Set<string>();
    runSessions.add(snapshot.id);
    this.runSessions.set(policyRunId, runSessions);
    this.onActivity?.(cwd, { event: 'browser.session.created', data: { sessionId: request.sessionId, runId: request.runId, browserSessionId: snapshot.id, tabId: snapshot.activeTabId } });
    return snapshot.id;
  }

  private assertActive(key: string, generation: number, signal?: AbortSignal): void {
    if (signal?.aborted === true || (this.sessionGenerations.get(key) ?? 0) !== generation) throw new Error('Browser action was cancelled.');
  }

  private bumpGeneration(key: string): void { this.sessionGenerations.set(key, (this.sessionGenerations.get(key) ?? 0) + 1); }

  private cleanupGeneration(key: string): void {
    if (!this.sessions.has(key) && !this.sessionRuns.has(key) && !this.serial.has(key)) this.sessionGenerations.delete(key);
  }

  private async runAction(cwd: string, sessionId: string, activeTabId: string, action: string, params: Record<string, unknown>): Promise<unknown> {
    switch (action) {
      case 'browser.navigate': {
        const url = requiredString(params, 'url', 4096);
        return this.browser.navigate(sessionId, activeTabId, url, true);
      }
      case 'browser.newTab':
        return this.browser.createTab(sessionId);
      case 'browser.closeTab':
        await this.browser.closeTab(sessionId, activeTabId);
        return { tabs: this.browser.get(sessionId).tabs, activeTabId: this.browser.get(sessionId).activeTabId };
      case 'browser.selectTab':
        return this.browser.selectTab(sessionId, requiredString(params, 'tabId', 256));
      case 'browser.inspect':
        return this.browser.inspect(sessionId, activeTabId);
      case 'browser.inspectElement':
        return this.browser.inspectElement(sessionId, activeTabId, requiredTarget(params['target']));
      case 'browser.extractTable':
        return this.browser.extractTable(sessionId, activeTabId, requiredTarget(params['target']), optionalInteger(params, 'maxRows', 1, 500, 100));
      case 'browser.drag':
        return this.browser.drag(sessionId, activeTabId, requiredTarget(params['from']), requiredTarget(params['to']));
      case 'browser.listFrames':
        return { frames: await this.browser.listFrames(sessionId, activeTabId) };
      case 'browser.console':
        return this.browser.console(sessionId, activeTabId, optionalLimit(params, 'limit'));
      case 'browser.network':
        return this.browser.network(sessionId, activeTabId, optionalLimit(params, 'limit'));
      case 'browser.accessibility':
        return this.browser.accessibility(sessionId, activeTabId);
      case 'browser.setViewport':
        return this.browser.setResponsiveViewport(sessionId, activeTabId, requiredViewport(params));
      case 'browser.resetViewport':
        return this.browser.resetResponsiveViewport(sessionId, activeTabId);
      case 'browser.screenshot': {
        const screenshot = await this.browser.screenshot(sessionId, activeTabId);
        return {
          evidenceId: screenshot.evidenceId,
          path: screenshot.path,
          dataUrl: screenshot.dataUrl,
        };
      }
      case 'browser.click':
        return this.browser.click(sessionId, activeTabId, requiredTarget(params['target']));
      case 'browser.focus':
        return this.browser.focus(sessionId, activeTabId, requiredTarget(params['target']));
      case 'browser.clear':
        return this.browser.clear(sessionId, activeTabId, requiredTarget(params['target']));
      case 'browser.hover':
        return this.browser.hover(sessionId, activeTabId, requiredTarget(params['target']));
      case 'browser.check':
        return this.browser.check(sessionId, activeTabId, requiredTarget(params['target']), requiredBoolean(params, 'checked'));
      case 'browser.select':
        return this.browser.selectOption(sessionId, activeTabId, requiredTarget(params['target']), requiredString(params, 'value', 4096));
      case 'browser.readField':
        return this.browser.readField(sessionId, activeTabId, requiredTarget(params['target']));
      case 'browser.type':
        return this.browser.type(sessionId, activeTabId, requiredTarget(params['target']), requiredString(params, 'value', 64 * 1024));
      case 'browser.upload': {
        const target = requiredTarget(params['target']);
        if (target.type !== 'css') throw new Error('Browser upload requires a CSS selector targeting a file input.');
        const filePath = await requireExistingPath(requiredString(params, 'path', 4_096), cwd);
        return this.browser.upload(sessionId, activeTabId, target.selector, filePath);
      }
      case 'browser.download':
        return this.browser.download(sessionId, activeTabId, requiredString(params, 'url', 4_096));
      case 'browser.exportPdf': {
        const outputPath = await requireWorkspaceMutationPath(requiredString(params, 'outputPath', 4_096), cwd);
        return this.browser.exportPdf(sessionId, activeTabId, outputPath, { overwrite: optionalBoolean(params, 'overwrite', false), printBackground: optionalBoolean(params, 'printBackground', true), landscape: optionalBoolean(params, 'landscape', false), pageSize: requiredPageSize(params['pageSize']) });
      }
      case 'browser.dialog':
        return this.browser.dialog(sessionId, activeTabId, requiredDialogAction(params), optionalString(params, 'promptText', 4_096));
      case 'browser.press':
        return this.browser.press(sessionId, activeTabId, requiredString(params, 'key', 32), optionalStringArray(params, 'modifiers', 4, 32));
      case 'browser.scroll':
        return this.browser.scroll(sessionId, activeTabId, optionalNumber(params, 'deltaX'), optionalNumber(params, 'deltaY', 600));
      case 'browser.back':
        return this.browser.goBack(sessionId, activeTabId);
      case 'browser.forward':
        return this.browser.goForward(sessionId, activeTabId);
      case 'browser.reload':
        return this.browser.reload(sessionId, activeTabId);
      case 'browser.waitFor':
        return this.browser.waitFor(sessionId, activeTabId, requiredWaitCondition(params['condition']), optionalNumber(params, 'timeoutMs', 15_000));
      case 'browser.tabs':
        return { tabs: this.browser.get(sessionId).tabs, activeTabId: this.browser.get(sessionId).activeTabId };
      default:
        throw new Error(`Unsupported browser action: ${action}.`);
    }
  }
}

function assertBrowserAccess(request: DesktopHostRequest, access: AutomationBrowserAccess | undefined): void {
  if (access === undefined || access === 'autonomous' || access === 'interactive') return;
  if (access === 'disabled') throw new Error('Browser access is disabled for this automation.');
  const readOnlyActions = new Set(['browser.navigate', 'browser.inspect', 'browser.inspectElement', 'browser.extractTable', 'browser.listFrames', 'browser.console', 'browser.network', 'browser.accessibility', 'browser.setViewport', 'browser.resetViewport', 'browser.screenshot', 'browser.readField', 'browser.waitFor', 'browser.tabs', 'browser.back', 'browser.forward', 'browser.reload']);
  if (!readOnlyActions.has(request.action)) throw new Error('This automation only has read-only browser access.');
}

function requiredString(params: Record<string, unknown>, key: string, maxLength: number): string {
  const value = params[key];
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > maxLength) throw new Error(`Browser parameter "${key}" is invalid.`);
  return value;
}

function optionalId(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 && value.length <= 256 ? value : undefined;
}

function optionalNumber(params: Record<string, unknown>, key: string, fallback = 0): number {
  const value = params[key];
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`Browser parameter "${key}" is invalid.`);
  return value;
}

function optionalBoolean(params: Record<string, unknown>, key: string, fallback: boolean): boolean { const value = params[key]; if (value === undefined) return fallback; if (typeof value !== 'boolean') throw new Error(`Browser parameter "${key}" is invalid.`); return value; }
function optionalInteger(params: Record<string, unknown>, key: string, minimum: number, maximum: number, fallback: number): number { const value = params[key]; if (value === undefined) return fallback; if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > maximum) throw new Error(`Browser parameter "${key}" is invalid.`); return value; }
function requiredPageSize(value: unknown): 'A4' | 'Letter' { if (value === undefined) return 'A4'; if (value === 'A4' || value === 'Letter') return value; throw new Error('Browser parameter "pageSize" is invalid.'); }

function requiredViewport(params: Record<string, unknown>): { width: number; height: number; mobile: boolean; deviceScaleFactor: number } {
  const width = boundedInteger(params, 'width', 320, 3_840);
  const height = boundedInteger(params, 'height', 240, 2_160);
  const mobile = params['mobile'] === undefined ? false : requiredBoolean(params, 'mobile');
  const deviceScaleFactor = params['deviceScaleFactor'] === undefined ? 1 : boundedNumber(params, 'deviceScaleFactor', 1, 3);
  return { width, height, mobile, deviceScaleFactor };
}

function boundedInteger(params: Record<string, unknown>, key: string, minimum: number, maximum: number): number { const value = params[key]; if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > maximum) throw new Error(`Browser parameter "${key}" is invalid.`); return value; }
function boundedNumber(params: Record<string, unknown>, key: string, minimum: number, maximum: number): number { const value = params[key]; if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) throw new Error(`Browser parameter "${key}" is invalid.`); return value; }
function optionalString(params: Record<string, unknown>, key: string, maxLength: number): string | undefined { const value = params[key]; if (value === undefined) return undefined; if (typeof value !== 'string' || value.length > maxLength) throw new Error(`Browser parameter "${key}" is invalid.`); return value; }
function requiredDialogAction(params: Record<string, unknown>): 'read' | 'accept' | 'dismiss' { const value = params['action']; if (value !== 'read' && value !== 'accept' && value !== 'dismiss') throw new Error('Browser dialog action is invalid.'); return value; }

function optionalLimit(params: Record<string, unknown>, key: string): number {
  const value = params[key];
  if (value === undefined) return 100;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > 200) throw new Error(`Browser parameter "${key}" is invalid.`);
  return value;
}

function requiredBoolean(params: Record<string, unknown>, key: string): boolean {
  if (typeof params[key] !== 'boolean') throw new Error(`Browser parameter "${key}" is invalid.`);
  return params[key] as boolean;
}

function optionalStringArray(params: Record<string, unknown>, key: string, maxItems: number, maxLength: number): string[] {
  const value = params[key];
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > maxItems || value.some(item => typeof item !== 'string' || item.length === 0 || item.length > maxLength)) throw new Error(`Browser parameter "${key}" is invalid.`);
  return value as string[];
}

function requiredWaitCondition(value: unknown): BrowserWaitCondition {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Browser wait condition is required.');
  const condition = value as Record<string, unknown>;
  if ((condition['type'] === 'selector' || condition['type'] === 'text' || condition['type'] === 'url') && typeof condition['value'] === 'string' && condition['value'].length > 0 && condition['value'].length <= 4096) return { type: condition['type'], value: condition['value'] };
  throw new Error('Browser wait condition is invalid.');
}

function requiredTarget(value: unknown): BrowserTarget {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Browser target is required.');
  const target = value as Record<string, unknown>;
  const type = target['type'];
  if (type === 'css' && typeof target['selector'] === 'string' && target['selector'].length > 0 && target['selector'].length <= 1024) return { type, selector: target['selector'] };
  if (type === 'text' && typeof target['value'] === 'string' && target['value'].trim().length > 0 && target['value'].length <= 512) return { type, value: target['value'] };
  if (type === 'accessibility' && (target['role'] === undefined || typeof target['role'] === 'string') && (target['name'] === undefined || typeof target['name'] === 'string')) return { type, ...(target['role'] === undefined ? {} : { role: target['role'] }), ...(target['name'] === undefined ? {} : { name: target['name'] }) };
  if (type === 'coordinates' && typeof target['x'] === 'number' && typeof target['y'] === 'number' && Number.isFinite(target['x']) && Number.isFinite(target['y'])) return { type, x: target['x'], y: target['y'] };
  throw new Error('Browser target is invalid.');
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : { value };
}
