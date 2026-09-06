import { z } from 'zod';
import { registerLoggedIpcHandler } from './logged-ipc.js';
import type { DesktopIpcServices } from './ipc-types.js';
import { MAX_QUEUED_PROMPTS_PER_TASK, queuedPromptSchema } from '../../contracts/ipc/v1/workspace.js';

export const cwdSchema = z.string().min(1).max(4_096);
export const idSchema = z.string().min(1).max(256);
export const browserBoundsSchema = z.object({ x: z.number().finite().min(0).max(10_000), y: z.number().finite().min(0).max(10_000), width: z.number().finite().min(0).max(10_000), height: z.number().finite().min(0).max(10_000) }).strict();
export const paginationPageSchema = z.number().int().min(1);
export const paginationLimitSchema = z.number().int().min(1).max(100);
export const activityPageOptionsSchema = z.object({ limit: paginationLimitSchema.optional(), before: idSchema.optional() }).strict();
export const objectSchema = z.record(z.string(), z.unknown());
export const taskUpdateSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  pinned: z.boolean().optional(),
  archived: z.boolean().optional(),
  draft: z.string().max(512 * 1024).optional(),
  draftAttachmentIds: z.array(idSchema).max(16).optional(),
  sessionId: idSchema.optional(),
  turnId: idSchema.optional(),
  model: z.string().min(1).max(256).optional(),
  lastEventCursor: z.number().int().nonnegative().optional(),
  interruptedReason: z.string().max(4_096).optional(),
  queuedPrompts: queuedPromptSchema.array().max(MAX_QUEUED_PROMPTS_PER_TASK).optional(),
}).strict();
export const taskTitleSourceInputSchema = z.enum(['automatic', 'manual']);

export interface IpcRegistrationContext extends DesktopIpcServices {
  services: DesktopIpcServices;
  cwdSchema: typeof cwdSchema;
  idSchema: typeof idSchema;
  browserBoundsSchema: typeof browserBoundsSchema;
  paginationPageSchema: typeof paginationPageSchema;
  paginationLimitSchema: typeof paginationLimitSchema;
  activityPageOptionsSchema: typeof activityPageOptionsSchema;
  objectSchema: typeof objectSchema;
  taskUpdateSchema: typeof taskUpdateSchema;
  taskTitleSourceInputSchema: typeof taskTitleSourceInputSchema;
  handle<TArgs extends unknown[], TResult>(channel: string, listener: (event: Electron.IpcMainInvokeEvent, ...args: TArgs) => TResult): void;
  requireWorkspaceCwd(input: unknown): Promise<string>;
}

export function createIpcRegistrationContext(services: DesktopIpcServices): IpcRegistrationContext {
  const handle = <TArgs extends unknown[], TResult>(channel: string, listener: (event: Electron.IpcMainInvokeEvent, ...args: TArgs) => TResult): void => registerLoggedIpcHandler(services.logger, channel, listener);
  const requireWorkspaceCwd = (input: unknown): Promise<string> => services.workspaces.requireRegisteredRoot(cwdSchema.parse(input));
  return { ...services, services, cwdSchema, idSchema, browserBoundsSchema, paginationPageSchema, paginationLimitSchema, activityPageOptionsSchema, objectSchema, taskUpdateSchema, taskTitleSourceInputSchema, handle, requireWorkspaceCwd };
}
