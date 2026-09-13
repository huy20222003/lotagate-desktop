import type { DesktopHostRequest } from '../../contracts/agent-protocol/v1/desktop.js';
import type { AutomationBrowserAccess } from '../../contracts/ipc/v1/automation.js';

export const READ_ONLY_BROWSER_ACTIONS: ReadonlySet<string> = new Set([
  'browser.navigate',
  'browser.inspect',
  'browser.inspectElement',
  'browser.extractTable',
  'browser.listFrames',
  'browser.console',
  'browser.network',
  'browser.accessibility',
  'browser.setViewport',
  'browser.resetViewport',
  'browser.screenshot',
  'browser.readField',
  'browser.waitFor',
  'browser.tabs',
  'browser.back',
  'browser.forward',
  'browser.reload',
]);

export function assertBrowserAccess(request: Pick<DesktopHostRequest, 'action'>, access: AutomationBrowserAccess | undefined): void {
  if (access === undefined || access === 'autonomous' || access === 'interactive') return;
  if (access === 'disabled') throw new Error('Browser access is disabled for this automation.');
  if (!READ_ONLY_BROWSER_ACTIONS.has(request.action)) throw new Error('This automation only has read-only browser access.');
}
