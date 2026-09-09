import { randomUUID } from 'node:crypto';
import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import type { DesktopLogger } from '../observability/desktop-logger.js';

export interface IpcCorrelationDetails {
  requestId?: string;
  sessionId?: string;
  turnId?: string;
  taskId?: string;
}

export function registerLoggedIpcHandler<TArgs extends unknown[], TResult>(logger: DesktopLogger, channel: string, listener: (event: IpcMainInvokeEvent, ...args: TArgs) => TResult): void {
  ipcMain.handle(channel, async (event, ...args) => {
    const startedAt = Date.now();
    const details = {
      channel,
      correlationId: randomUUID(),
      processId: event.processId,
      frameId: event.frameId,
      senderId: event.sender.id,
      ...extractIpcCorrelation(channel, args),
    };
    logger.info('ipc.action.started', details);
    try {
      const result = await listener(event, ...(args as TArgs));
      logger.info('ipc.action.completed', { ...details, durationMs: Date.now() - startedAt });
      return result;
    } catch (error) {
      logger.error('ipc.action.failed', { ...details, durationMs: Date.now() - startedAt, error: error instanceof Error ? error.message : 'Unknown IPC error.' });
      throw error;
    }
  });
}

export function extractIpcCorrelation(channel: string, args: readonly unknown[]): IpcCorrelationDetails {
  const details: IpcCorrelationDetails = {};
  for (const argument of args) collectCorrelation(argument, details, 0);
  if (channel.startsWith('task.') && channel !== 'task.create' && typeof args[0] === 'string') details.taskId = args[0];
  if (channel === 'checkpoint.list' || channel === 'checkpoint.undo') {
    const taskId = args[1];
    if (typeof taskId === 'string') details.taskId = taskId;
  }
  if (channel === 'checkpoint.undo' && typeof args[2] === 'string') details.turnId = args[2];
  if (channel === 'agent.turnClaim' && typeof args[1] === 'string') details.taskId = args[1];
  if (channel === 'agent.turnRelease' && typeof args[0] === 'string') details.taskId = args[0];
  if (channel === 'agent.turnCancel' && typeof args[1] === 'string') details.turnId = args[1];
  if ((channel === 'terminal.write' || channel === 'terminal.resize' || channel === 'terminal.close') && typeof args[0] === 'string') details.sessionId = args[0];
  return details;
}

function collectCorrelation(value: unknown, details: IpcCorrelationDetails, depth: number): void {
  if (depth > 2 || value === null || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const item of value) collectCorrelation(item, details, depth + 1);
    return;
  }
  for (const [key, entry] of Object.entries(value)) {
    if (isCorrelationKey(key) && typeof entry === 'string' && entry.length > 0) details[key] ??= entry;
    if (entry !== null && typeof entry === 'object') collectCorrelation(entry, details, depth + 1);
  }
}

function isCorrelationKey(value: string): value is keyof IpcCorrelationDetails {
  return value === 'requestId' || value === 'sessionId' || value === 'turnId' || value === 'taskId';
}
