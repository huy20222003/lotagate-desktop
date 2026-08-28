import type { DesktopHostRequest, DesktopHostResponse } from '../../contracts/agent-protocol/v1/desktop.js';
import type { AutomationBrowserAccess } from '../../contracts/ipc/v1/automation.js';
import { BrowserService, type BrowserTarget, type BrowserWaitCondition } from '../browser/browser-service.js';

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

  constructor(private readonly browser: BrowserService, private readonly onActivity?: (cwd: string, activity: BrowserHostActivity) => void) {}

  setRunPolicy(runId: string, access: AutomationBrowserAccess): void { this.runPolicies.set(runId, access); }
  bindSessionToRun(cwd: string, sessionId: string, runId: string): void { this.sessionRuns.set(`${cwd}\u0000${sessionId}`, runId); }
  clearRunPolicy(runId: string): void {
    this.runPolicies.delete(runId);
    for (const [key, sessionRunId] of this.sessionRuns) if (sessionRunId === runId) this.sessionRuns.delete(key);
  }
  async closeRun(runId: string): Promise<void> {
    const sessionIds = this.runSessions.get(runId);
    if (sessionIds !== undefined) {
      for (const sessionId of sessionIds) {
        for (const [key, mappedSessionId] of this.sessions) if (mappedSessionId === sessionId) this.sessions.delete(key);
        await this.browser.close(sessionId);
      }
    }
    this.runSessions.delete(runId);
    this.runPolicies.delete(runId);
    for (const [key, sessionRunId] of this.sessionRuns) if (sessionRunId === runId) this.sessionRuns.delete(key);
  }

  async handle(cwd: string, request: DesktopHostRequest): Promise<DesktopHostResponse> {
    const key = `${cwd}\u0000${request.sessionId}`;
    const previous = this.serial.get(key) ?? Promise.resolve();
    const operation = previous.catch(() => undefined).then(() => this.execute(cwd, request));
    const barrier = operation.then(() => undefined, () => undefined);
    this.serial.set(key, barrier);
    try {
      return await operation;
    } catch (error) {
      return {
        version: 1,
        type: 'host.response',
        requestId: request.requestId,
        tool: 'browser',
        ok: false,
        error: {
          code: 'BROWSER_HOST_ERROR',
          category: 'browser',
          message: error instanceof Error ? error.message : 'Browser action failed.',
          retryable: false,
        },
      };
    } finally {
      if (this.serial.get(key) === barrier) this.serial.delete(key);
    }
  }

  async closeForWorkspace(cwd: string): Promise<void> {
    const prefix = `${cwd}\u0000`;
    const closedSessionIds = new Set<string>();
    for (const [key, browserSessionId] of this.sessions) {
      if (!key.startsWith(prefix)) continue;
      this.sessions.delete(key);
      closedSessionIds.add(browserSessionId);
      await this.browser.close(browserSessionId);
    }
    for (const key of this.sessionRuns.keys()) if (key.startsWith(prefix)) this.sessionRuns.delete(key);
    for (const [runId, sessionIds] of this.runSessions) {
      for (const sessionId of closedSessionIds) sessionIds.delete(sessionId);
      if (sessionIds.size === 0) this.runSessions.delete(runId);
    }
  }

  private async execute(cwd: string, request: DesktopHostRequest): Promise<DesktopHostResponse> {
    const policyRunId = this.sessionRuns.get(`${cwd}\u0000${request.sessionId}`) ?? request.runId;
    assertBrowserAccess(request, this.runPolicies.get(policyRunId));
    const browserSessionId = await this.ensureSession(cwd, request);
    const tabId = optionalId(request.params['tabId']);
    const activeTabId = tabId ?? this.browser.get(browserSessionId).activeTabId;
    this.onActivity?.(cwd, { event: 'browser.action.started', data: { sessionId: request.sessionId, runId: request.runId, browserSessionId, tabId: activeTabId, action: request.action } });
    try {
      const result = await this.runAction(browserSessionId, activeTabId, request.action, request.params);
      this.onActivity?.(cwd, { event: 'browser.action.completed', data: { sessionId: request.sessionId, runId: request.runId, browserSessionId, tabId: activeTabId, action: request.action, success: true } });
      return { version: 1, type: 'host.response', requestId: request.requestId, tool: 'browser', ok: true, result: { browserSessionId, tabId: activeTabId, ...asRecord(result) } };
    } catch (error) {
      this.onActivity?.(cwd, { event: 'browser.action.completed', data: { sessionId: request.sessionId, runId: request.runId, browserSessionId, tabId: activeTabId, action: request.action, success: false } });
      throw error;
    }
  }

  private async ensureSession(cwd: string, request: DesktopHostRequest): Promise<string> {
    const key = `${cwd}\u0000${request.sessionId}`;
    const existing = this.sessions.get(key);
    if (existing !== undefined) return existing;
    const snapshot = await this.browser.create();
    this.sessions.set(key, snapshot.id);
    const policyRunId = this.sessionRuns.get(`${cwd}\u0000${request.sessionId}`) ?? request.runId;
    const runSessions = this.runSessions.get(policyRunId) ?? new Set<string>();
    runSessions.add(snapshot.id);
    this.runSessions.set(policyRunId, runSessions);
    this.onActivity?.(cwd, { event: 'browser.session.created', data: { sessionId: request.sessionId, runId: request.runId, browserSessionId: snapshot.id, tabId: snapshot.activeTabId } });
    return snapshot.id;
  }

  private async runAction(sessionId: string, activeTabId: string, action: string, params: Record<string, unknown>): Promise<unknown> {
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
      case 'browser.screenshot': {
        const screenshot = await this.browser.screenshot(sessionId, activeTabId);
        return { evidenceId: screenshot.evidenceId, path: screenshot.path };
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
  const readOnlyActions = new Set(['browser.navigate', 'browser.inspect', 'browser.screenshot', 'browser.readField', 'browser.waitFor', 'browser.tabs', 'browser.back', 'browser.forward', 'browser.reload']);
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
