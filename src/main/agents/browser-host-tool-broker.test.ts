import { describe, expect, it, vi } from 'vitest';
import type { DesktopHostRequest } from '../../contracts/agent-protocol/v1/desktop.js';
import type { BrowserService } from '../browser/browser-service.js';
import { BrowserHostToolBroker } from './browser-host-tool-broker.js';

const browserSnapshot = { id: 'browser-1', activeTabId: 'tab-1', tabs: [] };

describe('BrowserHostToolBroker', () => {
  it('routes every browser catalog action to the Desktop browser service', async () => {
    const browser = {
      create: vi.fn().mockResolvedValue(browserSnapshot),
      get: vi.fn().mockReturnValue(browserSnapshot),
      navigate: vi.fn().mockResolvedValue({}),
      createTab: vi.fn().mockResolvedValue({}),
      closeTab: vi.fn().mockResolvedValue(undefined),
      selectTab: vi.fn().mockResolvedValue({}),
      inspect: vi.fn().mockResolvedValue({}),
      inspectElement: vi.fn().mockResolvedValue({}),
      console: vi.fn().mockReturnValue({}),
      network: vi.fn().mockReturnValue({}),
      accessibility: vi.fn().mockResolvedValue({}),
      setResponsiveViewport: vi.fn().mockResolvedValue({}),
      resetResponsiveViewport: vi.fn().mockResolvedValue({}),
      screenshot: vi.fn().mockResolvedValue({ evidenceId: 'evidence-1', path: 'screenshot.png' }),
      click: vi.fn().mockResolvedValue({}),
      focus: vi.fn().mockResolvedValue({}),
      clear: vi.fn().mockResolvedValue({}),
      hover: vi.fn().mockResolvedValue({}),
      check: vi.fn().mockResolvedValue({}),
      selectOption: vi.fn().mockResolvedValue({}),
      readField: vi.fn().mockResolvedValue({}),
      type: vi.fn().mockResolvedValue({}),
      upload: vi.fn().mockResolvedValue({}),
      download: vi.fn().mockResolvedValue({}),
      dialog: vi.fn().mockResolvedValue({}),
      press: vi.fn().mockResolvedValue({}),
      scroll: vi.fn().mockResolvedValue({}),
      goBack: vi.fn().mockResolvedValue({}),
      goForward: vi.fn().mockResolvedValue({}),
      reload: vi.fn().mockResolvedValue({}),
      waitFor: vi.fn().mockResolvedValue({}),
    } as unknown as BrowserService;
    const broker = new BrowserHostToolBroker(browser);
    const cases: Array<[string, Record<string, unknown>]> = [
      ['browser.navigate', { url: 'https://example.test' }], ['browser.newTab', {}], ['browser.closeTab', {}], ['browser.selectTab', { tabId: 'tab-1' }],
      ['browser.inspect', {}], ['browser.inspectElement', { target: { type: 'css', selector: 'body' } }], ['browser.console', {}], ['browser.network', {}], ['browser.accessibility', {}],
      ['browser.setViewport', { width: 1280, height: 720 }], ['browser.resetViewport', {}], ['browser.screenshot', {}], ['browser.click', { target: { type: 'text', value: 'Open' } }],
      ['browser.focus', { target: { type: 'css', selector: '#name' } }], ['browser.clear', { target: { type: 'css', selector: '#name' } }], ['browser.hover', { target: { type: 'css', selector: '#menu' } }],
      ['browser.check', { target: { type: 'css', selector: '#terms' }, checked: true }], ['browser.select', { target: { type: 'css', selector: '#country' }, value: 'VN' }],
      ['browser.readField', { target: { type: 'css', selector: '#name' } }], ['browser.type', { target: { type: 'css', selector: '#name' }, value: 'LotaGate' }],
      ['browser.upload', { target: { type: 'css', selector: 'input[type=file]' }, path: 'package.json' }], ['browser.download', { url: 'https://example.test/file.txt' }],
      ['browser.dialog', { action: 'read' }], ['browser.press', { key: 'Enter' }], ['browser.scroll', { deltaY: 500 }], ['browser.back', {}], ['browser.forward', {}], ['browser.reload', {}],
      ['browser.waitFor', { condition: { type: 'text', value: 'Done' } }], ['browser.tabs', {}],
    ];
    for (const [action, params] of cases) {
      const response = await broker.handle(process.cwd(), request(action, params));
      expect(response.ok, action).toBe(true);
    }
    expect(browser.create).toHaveBeenCalledOnce();
    expect(browser.upload).toHaveBeenCalledOnce();
    expect(browser.download).toHaveBeenCalledOnce();
    expect(browser.dialog).toHaveBeenCalledOnce();
  });
});

function request(action: string, params: Record<string, unknown>): DesktopHostRequest {
  return { version: 1, type: 'host.request', requestId: `request-${action}`, tool: 'browser', sessionId: 'session-1', runId: 'run-1', action, params };
}
