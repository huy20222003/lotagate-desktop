import { spawn, type ChildProcess } from 'node:child_process';
import { TERMINATION_GRACE_MS, TERMINATION_TIMEOUT_MS } from './process-constants.js';
const pendingTerminations = new WeakMap<ChildProcess, Promise<void>>();

/** Terminates a Desktop-owned process and its descendants within a bounded deadline. */
export function terminateDesktopProcess(child: ChildProcess): Promise<void> {
  const pending = pendingTerminations.get(child);
  if (pending !== undefined) return pending;
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  if (child.pid === undefined) {
    try { child.kill(); } catch (error) { return Promise.reject(error instanceof Error ? error : new Error('Process termination could not be started.')); }
    return Promise.resolve();
  }
  const pid = child.pid;

  const operation = new Promise<void>((resolve, reject) => {
    let graceTimer: ReturnType<typeof setTimeout> | undefined;
    let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
    let treeKiller: ChildProcess | undefined;
    let childClosed = false;
    let treeTerminated = false;
    let terminationError: Error | undefined;
    let settled = false;

    const cleanup = (): void => {
      if (graceTimer !== undefined) clearTimeout(graceTimer);
      if (deadlineTimer !== undefined) clearTimeout(deadlineTimer);
      child.removeListener('close', onClose);
      child.removeListener('error', onError);
      if (treeKiller !== undefined && treeKiller.exitCode === null && treeKiller.signalCode === null) {
        try { treeKiller.kill(); } catch { /* The child termination result is already authoritative. */ }
      }
    };
    const settleIfReady = (): void => {
      if (settled || !childClosed || !treeTerminated) return;
      settled = true;
      cleanup();
      if (terminationError === undefined) resolve(); else reject(terminationError);
    };
    const fail = (error: Error): void => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const forceChild = (): void => {
      if (childClosed || child.exitCode !== null || child.signalCode !== null) return;
      try { child.kill(process.platform === 'win32' ? undefined : 'SIGKILL'); } catch { /* The bounded deadline reports an unconfirmed termination. */ }
    };
    const terminateUnixGroup = (signal: 'SIGTERM' | 'SIGKILL'): boolean => {
      try {
        process.kill(-pid, signal);
        return true;
      } catch (error) {
        if (isMissingProcess(error)) return true;
        terminationError ??= toError(error, 'Process group termination failed.');
        return false;
      }
    };
    const onClose = (): void => { childClosed = true; settleIfReady(); };
    const onError = (error: Error): void => { childClosed = true; terminationError ??= error; settleIfReady(); };

    child.once('close', onClose);
    child.once('error', onError);
    if (process.platform === 'win32') {
      try {
        treeKiller = spawn('taskkill', ['/pid', String(pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' });
        treeKiller.once('error', error => {
          terminationError ??= error;
          treeTerminated = true;
          forceChild();
          settleIfReady();
        });
        treeKiller.once('close', code => {
          if (code !== 0) terminationError ??= new Error(`taskkill could not terminate process tree ${String(pid)}.`);
          treeTerminated = true;
          forceChild();
          settleIfReady();
        });
      } catch (error) {
        terminationError = toError(error, 'Process tree termination could not be started.');
        treeTerminated = true;
        forceChild();
        settleIfReady();
      }
    } else {
      if (!terminateUnixGroup('SIGTERM')) {
        try { child.kill('SIGTERM'); } catch (error) { terminationError ??= toError(error, 'Process termination could not be started.'); }
      }
      graceTimer = setTimeout(() => {
        treeTerminated = terminateUnixGroup('SIGKILL');
        forceChild();
        settleIfReady();
      }, TERMINATION_GRACE_MS);
    }
    deadlineTimer = setTimeout(() => {
      if (settled) return;
      if (!treeTerminated && process.platform !== 'win32') treeTerminated = terminateUnixGroup('SIGKILL');
      forceChild();
      if (childClosed && treeTerminated) settleIfReady();
      else fail(new Error(`Process ${String(pid)} did not close after forced termination.`));
    }, TERMINATION_TIMEOUT_MS);
  });
  pendingTerminations.set(child, operation);
  return operation;
}

function isMissingProcess(error: unknown): boolean { return typeof error === 'object' && error !== null && (error as NodeJS.ErrnoException).code === 'ESRCH'; }
function toError(error: unknown, fallback: string): Error { return error instanceof Error ? error : new Error(fallback); }
