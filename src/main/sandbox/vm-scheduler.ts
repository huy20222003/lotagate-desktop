/**
 * Coordinates bounded VM work without coupling scheduling to a concrete
 * hypervisor. Operations for one environment are serialized because the
 * guest workspace is shared, while operations for different environments may
 * run concurrently up to the configured global limit.
 */
export class VmScheduler {
  private readonly queues = new Map<string, Promise<void>>();
  private readonly waiters: Array<() => void> = [];
  private running = 0;

  async run<T>(key: string, maxConcurrentOperations: number, signal: AbortSignal | undefined, callback: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(key) ?? Promise.resolve();
    let releaseQueue!: () => void;
    const current = new Promise<void>(resolve => { releaseQueue = resolve; });
    const chain = previous.then(() => current);
    this.queues.set(key, chain);
    try {
      await waitForPrevious(previous, signal);
      await this.acquire(maxConcurrentOperations, signal);
      try {
        return await callback();
      } finally {
        this.release();
      }
    } finally {
      releaseQueue();
      void chain.then(
        () => { if (this.queues.get(key) === chain) this.queues.delete(key); },
        () => { if (this.queues.get(key) === chain) this.queues.delete(key); },
      );
    }
  }

  private async acquire(limit: number, signal: AbortSignal | undefined): Promise<void> {
    const normalizedLimit = Math.max(1, Math.trunc(limit));
    while (this.running >= normalizedLimit) await this.waitForSlot(signal);
    this.running += 1;
  }

  private release(): void {
    this.running = Math.max(0, this.running - 1);
    this.waiters.shift()?.();
  }

  private waitForSlot(signal: AbortSignal | undefined): Promise<void> {
    if (signal?.aborted === true) return Promise.reject(new Error('VM sandbox execution was cancelled.'));
    return new Promise((resolve, reject) => {
      const callback = (): void => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      };
      const onAbort = (): void => {
        const index = this.waiters.indexOf(callback);
        if (index >= 0) this.waiters.splice(index, 1);
        reject(new Error('VM sandbox execution was cancelled.'));
      };
      this.waiters.push(callback);
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }
}

function waitForPrevious(previous: Promise<void>, signal: AbortSignal | undefined): Promise<void> {
  if (signal?.aborted === true) return Promise.reject(new Error('VM sandbox execution was cancelled.'));
  if (signal === undefined) return previous;
  return new Promise((resolve, reject) => {
    const onAbort = (): void => {
      signal.removeEventListener('abort', onAbort);
      reject(new Error('VM sandbox execution was cancelled.'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
    void previous.then(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, error => {
      signal.removeEventListener('abort', onAbort);
      reject(error);
    });
  });
}
