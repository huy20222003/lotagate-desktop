import { z } from 'zod';

/**
 * The Desktop JSONL contract is v1. Local memory commands are exposed through
 * the shared CLI command catalog and remain project-scoped.
 */
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
  requestBase.extend({ method: z.literal('title.generate'), params }),
  requestBase.extend({ method: z.literal('attachment.begin'), params }),
  requestBase.extend({ method: z.literal('attachment.chunk'), params }),
  requestBase.extend({ method: z.literal('attachment.complete'), params }),
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
  scope: z.enum(['session', 'control']),
  event: z.string().min(1).max(128),
  data: params,
});

export const desktopHostRequestSchema = z.object({
  version: z.literal(DESKTOP_PROTOCOL_VERSION),
  type: z.literal('host.request'),
  requestId: id,
  tool: z.enum(['browser', 'filesystem', 'shell', 'git', 'artifact']),
  sessionId: id,
  runId: id,
  action: z.string().min(1).max(128),
  params,
  executionBoundary: z.enum(['sandbox', 'host']),
  hostFallback: z.enum(['ask', 'deny', 'allow']).default('deny'),
  projectRoot: z.string().min(1).max(4_096).optional(),
  executionCwd: z.string().min(1).max(4_096).optional(),
  executionWorkspaceId: id.optional(),
});

export const desktopHostResponseSchema = z.object({
  version: z.literal(DESKTOP_PROTOCOL_VERSION),
  type: z.literal('host.response'),
  requestId: id,
  tool: z.enum(['browser', 'filesystem', 'shell', 'git', 'artifact']),
  ok: z.boolean(),
  result: z.unknown().optional(),
  error: z.object({
    code: z.string().min(1).max(128),
    category: z.string().min(1).max(128),
    message: z.string().min(1).max(4096),
    retryable: z.boolean(),
  }).optional(),
  executionBoundary: z.enum(['sandbox', 'host']).optional(),
  fallbackReason: z.string().max(512).optional(),
  fileChange: z.object({
    path: z.string().min(1).max(4_096),
    lines: z.array(z.object({ kind: z.enum(['context', 'addition', 'deletion']), text: z.string(), oldLine: z.number().int().positive().optional(), newLine: z.number().int().positive().optional() })).max(512),
    additions: z.number().int().nonnegative(),
    deletions: z.number().int().nonnegative(),
    truncated: z.boolean(),
  }).optional(),
});

export type DesktopResponse = z.infer<typeof desktopResponseSchema>;
export type DesktopEvent = z.infer<typeof desktopEventSchema>;
export type DesktopHostRequest = z.infer<typeof desktopHostRequestSchema>;
export type DesktopHostResponse = z.infer<typeof desktopHostResponseSchema>;
export type DesktopAgentResult = { protocol: 'lotagate.desktop'; version: 1; capabilities: string[] };
export type DesktopExecutionPolicy = {
  permissionPolicy: 'ask' | 'allowlist' | 'review' | 'autonomous';
  allowedTools?: readonly string[];
  browserAccess: 'disabled' | 'read-only' | 'interactive' | 'autonomous';
  isolation: 'sandbox' | 'host';
  hostFallback: 'ask' | 'deny' | 'allow';
  timeoutMs: number;
  retryAttempt?: number;
};

export type DesktopSkillSelection = readonly string[];
export const DESKTOP_REASONING_EFFORTS = ['low', 'medium', 'high'] as const;
export type DesktopReasoningEffort = typeof DESKTOP_REASONING_EFFORTS[number];
export const DEFAULT_DESKTOP_REASONING_EFFORT: DesktopReasoningEffort = 'medium';

export function parseDesktopResponse(value: unknown): DesktopResponse {
  return desktopResponseSchema.parse(value);
}

export function parseDesktopEvent(value: unknown): DesktopEvent {
  const parsed = desktopEventSchema.safeParse(value);
  if (parsed.success) return parsed.data;
  if (!isRecord(value) || 'scope' in value || !isRecord(value['data'])) return desktopEventSchema.parse(value);
  return desktopEventSchema.parse({ ...value, scope: typeof value['data']['sessionId'] === 'string' ? 'session' : 'control' });
}

export function parseDesktopHostRequest(value: unknown): DesktopHostRequest {
  return desktopHostRequestSchema.parse(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
