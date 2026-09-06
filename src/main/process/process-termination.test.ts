import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock('node:child_process', () => ({ spawn: mocks.spawn }));

import { terminateDesktopProcess } from './process-termination.js';

describe('terminateDesktopProcess', () => {
  it('uses taskkill tree termination and waits for both processes on Windows', async () => {
    if (process.platform !== 'win32') return;
    const child = fakeProcess(42);
    const treeKiller = fakeProcess(43);
    mocks.spawn.mockReturnValueOnce(treeKiller);

    const pending = terminateDesktopProcess(child);
    expect(mocks.spawn).toHaveBeenCalledWith('taskkill', ['/pid', '42', '/t', '/f'], expect.objectContaining({ windowsHide: true, stdio: 'ignore' }));

    child.emit('close', 1, null);
    let settled = false;
    void pending.then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);

    treeKiller.emit('close', 0, null);
    await expect(pending).resolves.toBeUndefined();
  });
});

function fakeProcess(pid: number): ChildProcess {
  const child = new EventEmitter() as unknown as ChildProcess & Record<string, unknown>;
  const fields = child as unknown as Record<string, unknown>;
  fields['pid'] = pid;
  fields['exitCode'] = null;
  fields['signalCode'] = null;
  fields['kill'] = vi.fn(() => true);
  return child;
}
