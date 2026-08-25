import { z } from 'zod';

export const DESKTOP_PROTOCOL_VERSION = 1 as const;

const id = z.string().min(1).max(256);
const params = z.record(z.string(), z.unknown());

const requestBase = z.object({
  version: z.literal(DESKTOP_PROTOCOL_VERSION),
  id,
});

export const desktopRequestSchema = z.discriminatedUnion('method', [
  requestBase.extend({ method: z.literal('initialize'), params }),
  requestBase.extend({ method: z.literal('session.create'), params }),
  requestBase.extend({ method: z.literal('session.list'), params }),
  requestBase.extend({ method: z.literal('session.resume'), params }),
  requestBase.extend({ method: z.literal('turn.start'), params }),
  requestBase.extend({ method: z.literal('turn.cancel'), params }),
  requestBase.extend({ method: z.literal('approval.respond'), params }),
  requestBase.extend({ method: z.literal('trust.respond'), params }),
  requestBase.extend({ method: z.literal('model.list'), params }),
  requestBase.extend({ method: z.literal('auth.status'), params }),
  requestBase.extend({ method: z.literal('command.list'), params }),
  requestBase.extend({ method: z.literal('command.execute'), params }),
  requestBase.extend({ method: z.literal('command.cancel'), params }),
  requestBase.extend({ method: z.literal('shutdown'), params }),
]);

export const desktopResponseSchema = z.object({
  version: z.literal(DESKTOP_PROTOCOL_VERSION),
  id,
  type: z.literal('response'),
  method: z.string().min(1).max(128),
  ok: z.boolean(),
  result: z.unknown().optional(),
  error: z.object({
    code: z.string().min(1).max(128),
    category: z.string().min(1).max(128),
    message: z.string().min(1).max(4096),
    retryable: z.boolean(),
  }).optional(),
});

export const desktopEventSchema = z.object({
  version: z.literal(DESKTOP_PROTOCOL_VERSION),
  type: z.literal('event'),
  event: z.string().min(1).max(128),
  data: params,
});

export type DesktopRequest = z.infer<typeof desktopRequestSchema>;
export type DesktopResponse = z.infer<typeof desktopResponseSchema>;
export type DesktopEvent = z.infer<typeof desktopEventSchema>;
export type DesktopAgentResult = { protocol: 'lotagate.desktop'; version: 1; capabilities: string[] };

export function parseDesktopResponse(value: unknown): DesktopResponse {
  return desktopResponseSchema.parse(value);
}

export function parseDesktopEvent(value: unknown): DesktopEvent {
  return desktopEventSchema.parse(value);
}
