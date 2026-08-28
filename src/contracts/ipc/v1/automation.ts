import { z } from 'zod';

const automationId = z.string().min(1).max(256);
const timezoneSchema = z.string().min(1).max(128);
const clockTimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/u, 'Time must use HH:mm format.');

export const automationPermissionPolicySchema = z.enum(['ask', 'allowlist', 'review', 'autonomous']);
export const automationBrowserAccessSchema = z.enum(['disabled', 'read-only', 'interactive', 'autonomous']);
export const automationToolSchema = z.enum([
  'filesystem.read', 'filesystem.write', 'terminal.read', 'terminal.execute',
  'git.read', 'git.stage', 'git.commit', 'git.push', 'browser.navigate',
  'browser.inspect', 'browser.interact', 'browser.download', 'artifact.create',
]);

export const automationScheduleSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('manual') }).strict(),
  z.object({ kind: z.literal('once'), at: z.string().datetime(), timezone: timezoneSchema }).strict(),
  z.object({ kind: z.literal('interval'), everyMinutes: z.number().int().min(1).max(7 * 24 * 60), startAt: z.string().datetime().optional(), timezone: timezoneSchema }).strict(),
  z.object({ kind: z.literal('daily'), time: clockTimeSchema, timezone: timezoneSchema }).strict(),
  z.object({ kind: z.literal('weekly'), days: z.array(z.number().int().min(0).max(6)).min(1).max(7), time: clockTimeSchema, timezone: timezoneSchema }).strict(),
  z.object({ kind: z.literal('cron'), expression: z.string().trim().min(9).max(128), timezone: timezoneSchema }).strict(),
]);

export const automationRetryPolicySchema = z.object({ maxAttempts: z.number().int().min(0).max(3), backoffMs: z.number().int().min(500).max(5 * 60 * 1_000) }).strict();

export const automationSchema = z.object({
  id: automationId,
  name: z.string().trim().min(1).max(120),
  description: z.string().max(500),
  prompt: z.string().trim().min(1).max(64 * 1024),
  workspaceId: z.string().min(1).max(256),
  branch: z.string().trim().min(1).max(256).optional(),
  worktree: z.boolean(),
  model: z.string().trim().min(1).max(256).optional(),
  skills: z.array(z.string().trim().min(1).max(256)).max(32),
  tools: z.array(automationToolSchema).max(64),
  permissionPolicy: automationPermissionPolicySchema,
  browserAccess: automationBrowserAccessSchema,
  schedule: automationScheduleSchema,
  retryPolicy: automationRetryPolicySchema,
  timeoutMs: z.number().int().min(10_000).max(2 * 60 * 60 * 1_000),
  notifications: z.boolean(),
  keepSession: z.boolean(),
  enabled: z.boolean(),
  nextRunAt: z.string().datetime().nullable(),
  lastRunAt: z.string().datetime().nullable(),
  lastError: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
}).strict();

export const automationRunStatusSchema = z.enum(['queued', 'running', 'awaiting_approval', 'succeeded', 'failed', 'cancelled', 'timed_out', 'awaiting_review', 'skipped']);
export const automationReviewStatusSchema = z.enum(['not_required', 'pending', 'approved', 'rejected']);
export const automationApprovalSchema = z.object({ approvalId: z.string().min(1).max(256), toolName: z.string().min(1).max(256), displayName: z.string().min(1).max(256), kind: z.string().min(1).max(128), detail: z.record(z.string(), z.unknown()), requestedAt: z.string().datetime() }).strict();
export const automationRunSchema = z.object({
  id: automationId,
  automationId,
  status: automationRunStatusSchema,
  attempt: z.number().int().min(1),
  taskId: z.string().min(1).max(256).optional(),
  sessionId: z.string().min(1).max(256).optional(),
  executionCwd: z.string().min(1).max(4_096).optional(),
  branch: z.string().min(1).max(256).optional(),
  worktreePath: z.string().min(1).max(4_096).optional(),
  error: z.string().max(4_096).optional(),
  summary: z.string().max(8_192).optional(),
  changedFiles: z.array(z.string().max(4_096)).max(2_000),
  artifactIds: z.array(z.string().max(256)).max(256),
  pendingApproval: automationApprovalSchema.optional(),
  reviewStatus: automationReviewStatusSchema,
  startedAt: z.string().datetime().optional(),
  finishedAt: z.string().datetime().optional(),
  createdAt: z.string().datetime(),
}).strict();

export const automationCreateInputSchema = automationSchema.omit({ id: true, enabled: true, nextRunAt: true, lastRunAt: true, lastError: true, createdAt: true, updatedAt: true }).extend({
  description: z.string().max(500).default(''),
  worktree: z.boolean().default(false),
  skills: z.array(z.string().trim().min(1).max(256)).max(32).default([]),
  tools: z.array(automationToolSchema).max(64).default([]),
  permissionPolicy: automationPermissionPolicySchema.default('ask'),
  browserAccess: automationBrowserAccessSchema.default('disabled'),
  retryPolicy: automationRetryPolicySchema.default({ maxAttempts: 0, backoffMs: 1_000 }),
  timeoutMs: z.number().int().min(10_000).max(2 * 60 * 60 * 1_000).default(60 * 60 * 1_000),
  notifications: z.boolean().default(true),
  keepSession: z.boolean().default(true),
}).strict();
export const automationUpdateInputSchema = automationCreateInputSchema.partial().extend({ enabled: z.boolean().optional() }).strict();

export type AutomationPermissionPolicy = z.infer<typeof automationPermissionPolicySchema>;
export type AutomationBrowserAccess = z.infer<typeof automationBrowserAccessSchema>;
export type AutomationTool = z.infer<typeof automationToolSchema>;
export type AutomationSchedule = z.infer<typeof automationScheduleSchema>;
export type AutomationRetryPolicy = z.infer<typeof automationRetryPolicySchema>;
export type Automation = z.infer<typeof automationSchema>;
export type AutomationCreateInput = z.input<typeof automationCreateInputSchema>;
export type AutomationUpdateInput = z.input<typeof automationUpdateInputSchema>;
export type AutomationRunStatus = z.infer<typeof automationRunStatusSchema>;
export type AutomationReviewStatus = z.infer<typeof automationReviewStatusSchema>;
export type AutomationRun = z.infer<typeof automationRunSchema>;
export type AutomationApproval = z.infer<typeof automationApprovalSchema>;
export type AutomationStateEvent = { type: 'created' | 'updated' | 'removed' | 'started' | 'completed' | 'failed' | 'cancelled' | 'approval_requested' | 'paused' | 'resumed' | 'reviewed'; automationId: string; automation?: Automation; run?: AutomationRun };
