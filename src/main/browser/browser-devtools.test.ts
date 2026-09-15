import { describe, expect, it, vi } from 'vitest';
import type { WebContents } from 'electron';
import { resetViewport, setViewport } from './browser-devtools.js';

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>(complete => { resolve = complete; });
  return { promise, resolve };
}

describe('browser DevTools coordination', () => {
  it('serializes viewport changes with another CDP operation on the same tab', async () => {
    const firstCommand = deferred();
    let attached = false;
    const commands: string[] = [];
    const debuggerInstance = {
      isAttached: vi.fn(() => attached),
      attach: vi.fn(() => { attached = true; }),
      detach: vi.fn(() => { attached = false; }),
      sendCommand: vi.fn(async (command: string) => {
        commands.push(command);
        if (command === 'Emulation.setDeviceMetricsOverride') await firstCommand.promise;
        return {};
      }),
    };
    const contents = { debugger: debuggerInstance } as unknown as WebContents;

    const apply = setViewport(contents, { width: 1_280, height: 800, mobile: false, deviceScaleFactor: 1 });
    const reset = resetViewport(contents);
    await vi.waitFor(() => expect(commands).toEqual(['Emulation.setDeviceMetricsOverride']));
    firstCommand.resolve();
    await Promise.all([apply, reset]);

    expect(commands).toEqual(['Emulation.setDeviceMetricsOverride', 'Emulation.setDeviceMetricsOverride', 'Emulation.clearDeviceMetricsOverride']);
    expect(debuggerInstance.attach).toHaveBeenCalledTimes(2);
    expect(debuggerInstance.detach).toHaveBeenCalledTimes(2);
  });
});
