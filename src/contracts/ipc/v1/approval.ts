import { z } from 'zod';

export const desktopApprovalSourceSchema = z.enum(['agent', 'browser', 'computer', 'git', 'terminal', 'automation']);
export const desktopApprovalSurfaceSchema = z.enum(['composer', 'automation']);
export const desktopApprovalRiskSchema = z.enum(['normal', 'elevated']);
export const desktopApprovalInputSchema = z.object({
  approvalId: z.string().min(1).max(256).optional(),
  source: desktopApprovalSourceSchema,
  surface: desktopApprovalSurfaceSchema,
  toolName: z.string().min(1).max(256),
  displayName: z.string().min(1).max(256).optional(),
  kind: z.string().min(1).max(128).optional(),
  detail: z.record(z.string(), z.unknown()).default({}),
  executionBoundary: z.enum(['sandbox', 'host']).optional(),
  fallbackReason: z.string().max(512).optional(),
  risk: desktopApprovalRiskSchema.default('normal'),
  timeoutMs: z.number().int().min(10_000).max(15 * 60 * 1_000).optional(),
  taskId: z.string().min(1).max(256).optional(),
  sessionId: z.string().min(1).max(256).optional(),
  turnId: z.string().min(1).max(256).optional(),
  workspaceCwd: z.string().min(1).max(4_096).optional(),
}).strict();

export const desktopApprovalRequestSchema = desktopApprovalInputSchema.extend({
  approvalId: z.string().min(1).max(256),
  requestedAt: z.string().datetime(),
}).strict();

export const desktopApprovalDecisionSchema = z.discriminatedUnion('decision', [
  z.object({ decision: z.literal('allow') }).strict(),
  z.object({ decision: z.literal('deny') }).strict(),
  z.object({ decision: z.literal('redirect'), message: z.string().trim().min(1).max(512 * 1024) }).strict(),
]);

export type DesktopApprovalDecision =
  | { decision: 'allow' }
  | { decision: 'deny' }
  | { decision: 'redirect'; message: string };
export type DesktopApprovalResponse = DesktopApprovalDecision | boolean;
export interface DesktopApprovalResolution { approvalId: string; approved: boolean; decision: DesktopApprovalDecision['decision']; message?: string; result?: unknown }
export type DesktopApprovalInput = z.input<typeof desktopApprovalInputSchema>;
export type DesktopApprovalRequest = z.infer<typeof desktopApprovalRequestSchema>;

export interface DesktopApprovalApi {
  request(input: DesktopApprovalInput): Promise<DesktopApprovalResolution>;
  respond(approvalId: string, decision: DesktopApprovalResponse, owner?: { taskId?: string; sessionId?: string }): Promise<DesktopApprovalResolution>;
  onRequest(listener: (request: DesktopApprovalRequest) => void): () => void;
  onResolved(listener: (resolution: DesktopApprovalResolution) => void): () => void;
}
