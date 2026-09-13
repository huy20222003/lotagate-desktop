import { describe, expect, it } from 'vitest';
import { VmScheduler } from './vm-scheduler.js';

describe('VmScheduler', () => {
  it('keeps later work behind an earlier operation whose queued successor was cancelled', async () => {
    const scheduler = new VmScheduler();
    const order: string[] = [];
    let releaseFirst!: () => void;
    const firstStarted = new Promise<void>(resolve => {
      releaseFirst = resolve;
    });
    const first = scheduler.run('workspace', 1, undefined, async () => {
      order.push('first-started');
      await firstStarted;
      order.push('first-finished');
      return 'first';
    });

    await new Promise<void>(resolve => setImmediate(resolve));
    const controller = new AbortController();
    const cancelled = scheduler.run('workspace', 1, controller.signal, async () => {
      order.push('cancelled-started');
      return 'cancelled';
    });
    controller.abort();
    await expect(cancelled).rejects.toThrow('cancelled');

    let thirdFinished = false;
    const third = scheduler.run('workspace', 1, undefined, async () => {
      order.push('third-started');
      thirdFinished = true;
      return 'third';
    });
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(thirdFinished).toBe(false);

    releaseFirst();
    await expect(first).resolves.toBe('first');
    await expect(third).resolves.toBe('third');
    expect(order).toEqual(['first-started', 'first-finished', 'third-started']);
  });
});
