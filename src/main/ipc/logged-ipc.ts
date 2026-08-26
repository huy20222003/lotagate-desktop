import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import type { DesktopLogger } from '../observability/desktop-logger.js';

export function registerLoggedIpcHandler<TArgs extends unknown[], TResult>(logger: DesktopLogger, channel: string, listener: (event: IpcMainInvokeEvent, ...args: TArgs) => TResult): void {
  ipcMain.handle(channel, async (event, ...args) => {
    logger.info('ipc.action.started', { channel });
    try {
      const result = await listener(event, ...(args as TArgs));
      logger.info('ipc.action.completed', { channel });
      return result;
    } catch (error) {
      logger.error('ipc.action.failed', { channel, error: error instanceof Error ? error.message : 'Unknown IPC error.' });
      throw error;
    }
  });
}
