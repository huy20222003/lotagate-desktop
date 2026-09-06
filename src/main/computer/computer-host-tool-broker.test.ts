import { describe, expect, it, vi } from 'vitest';
import type { DesktopHostRequest } from '../../contracts/agent-protocol/v1/desktop.js';
import { ComputerHostToolBroker } from './computer-host-tool-broker.js';

function request(action: string, params: Record<string, unknown> = {}): DesktopHostRequest {
  return { version: 1, type: 'host.request', requestId: `request-${action}`, tool: 'computer', sessionId: 'session-1', runId: 'run-1', action, params, executionBoundary: 'host', hostFallback: 'deny' };
}

describe('ComputerHostToolBroker', () => {
  it('serializes actions for the same window', async () => {
    const order: string[] = [];
    let release!: () => void;
    const runtime = { execute: vi.fn(async (action: string) => { order.push(`start:${action}`); if (action === 'computer.click') await new Promise<void>(resolve => { release = resolve; }); order.push(`end:${action}`); return { action }; }) };
    const broker = new ComputerHostToolBroker(runtime);
    const first = broker.handle('C:/workspace', request('computer.click', { windowId: '10' }));
    const second = broker.handle('C:/workspace', request('computer.type', { windowId: '10' }));
    await Promise.resolve();
    expect(order).toEqual(['start:computer.click']);
    release();
    await Promise.all([first, second]);
    expect(order).toEqual(['start:computer.click', 'end:computer.click', 'start:computer.type', 'end:computer.type']);
  });

  it('serializes actions across sessions because native input is machine-global', async () => {
    const order: string[] = [];
    let release!: () => void;
    const runtime = { execute: vi.fn(async (action: string) => { order.push(`start:${action}`); if (action === 'computer.click') await new Promise<void>(resolve => { release = resolve; }); order.push(`end:${action}`); return { action }; }) };
    const broker = new ComputerHostToolBroker(runtime);
    const first = broker.handle('C:/one', request('computer.click', { windowId: '10' }));
    const secondRequest = { ...request('computer.type', { windowId: '20' }), requestId: 'request-second', sessionId: 'session-2' };
    const second = broker.handle('C:/two', secondRequest);
    await Promise.resolve();
    expect(order).toEqual(['start:computer.click']);
    release();
    await Promise.all([first, second]);
    expect(order).toEqual(['start:computer.click', 'end:computer.click', 'start:computer.type', 'end:computer.type']);
  });

  it('returns a structured cancellation response before executing', async () => {
    const runtime = { execute: vi.fn() };
    const broker = new ComputerHostToolBroker(runtime);
    const controller = new AbortController();
    controller.abort();
    const response = await broker.handle('C:/workspace', request('computer.click'), controller.signal);
    expect(response).toMatchObject({ ok: false, tool: 'computer', error: { code: 'COMPUTER_CANCELLED' } });
    expect(runtime.execute).not.toHaveBeenCalled();
  });

  it('aborts an active native action when the caller cancels', async () => {
    let runtimeAborted = false;
    const runtime = {
      execute: vi.fn(async (_action: string, _params: Record<string, unknown>, signal?: AbortSignal) => new Promise<never>((_resolve, reject) => {
        signal?.addEventListener('abort', () => { runtimeAborted = true; reject(new Error('cancelled')); }, { once: true });
      })),
    };
    const broker = new ComputerHostToolBroker(runtime);
    const controller = new AbortController();
    const pending = broker.handle('C:/workspace', request('computer.click'), controller.signal);
    await Promise.resolve();
    controller.abort();
    const response = await pending;
    expect(response).toMatchObject({ ok: false, error: { code: 'COMPUTER_CANCELLED' } });
    expect(runtimeAborted).toBe(true);
  });
});
