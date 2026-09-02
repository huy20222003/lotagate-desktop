import { z } from 'zod';
import type { Activity, Task, TaskStatus, Workspace } from '../../ipc/v1/workspace.js';
import type { DesktopApprovalRequest } from '../../ipc/v1/approval.js';

export const REMOTE_CONTROL_PROTOCOL_VERSION = 1 as const;
export const REMOTE_ATTACHMENT_CHUNK_BYTES = 48 * 1024;
export const REMOTE_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;
export const remoteControlStatusSchema = z.enum(['idle', 'creating', 'connecting', 'connected', 'reconnecting', 'offline', 'expired', 'revoked', 'error']);
export const remoteEnvelopeSchema = z.object({
  version: z.literal(REMOTE_CONTROL_PROTOCOL_VERSION),
  type: z.literal('encrypted'),
  messageId: z.string().min(1).max(256),
  sequence: z.number().int().nonnegative(),
  sentAt: z.string().datetime(),
  nonce: z.string().min(1).max(128),
  ciphertext: z.string().min(1).max(512 * 1024),
}).strict();

export const remoteCommandSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('snapshot.request'), taskId: z.string().min(1).max(256).optional() }).strict(),
  z.object({ action: z.literal('task.create'), workspaceId: z.string().min(1).max(256), title: z.string().min(1).max(120) }).strict(),
  z.object({ action: z.literal('workspace.fileSuggestions'), workspaceId: z.string().min(1).max(256), query: z.string().max(256) }).strict(),
  z.object({ action: z.literal('prompt'), taskId: z.string().min(1).max(256), prompt: z.string().min(1).max(512 * 1024), model: z.string().min(1).max(256).optional(), attachmentIds: z.array(z.string().min(1).max(256)).max(16).optional() }).strict(),
  z.object({ action: z.literal('attachment.start'), taskId: z.string().min(1).max(256), name: z.string().min(1).max(200), mimeType: z.string().min(1).max(128), sizeBytes: z.number().int().positive().max(REMOTE_ATTACHMENT_MAX_BYTES), chunkCount: z.number().int().positive().max(Math.ceil(REMOTE_ATTACHMENT_MAX_BYTES / REMOTE_ATTACHMENT_CHUNK_BYTES)) }).strict(),
  z.object({ action: z.literal('attachment.chunk'), uploadId: z.string().uuid(), index: z.number().int().nonnegative().max(Math.ceil(REMOTE_ATTACHMENT_MAX_BYTES / REMOTE_ATTACHMENT_CHUNK_BYTES) - 1), bytes: z.string().min(1).max(Math.ceil(REMOTE_ATTACHMENT_CHUNK_BYTES * 4 / 3) + 4) }).strict(),
  z.object({ action: z.literal('attachment.complete'), uploadId: z.string().uuid() }).strict(),
  z.object({ action: z.literal('attachment.abort'), uploadId: z.string().uuid() }).strict(),
  z.object({ action: z.literal('cancel'), taskId: z.string().min(1).max(256) }).strict(),
  z.object({ action: z.literal('approval.respond'), approvalId: z.string().min(1).max(256), approved: z.boolean(), taskId: z.string().min(1).max(256).optional(), sessionId: z.string().min(1).max(256).optional() }).strict(),
  z.object({ action: z.literal('trust.respond'), cwd: z.string().min(1).max(4_096), trustRequestId: z.string().min(1).max(256), trusted: z.boolean() }).strict(),
  z.object({ action: z.literal('command.execute'), taskId: z.string().min(1).max(256), input: z.object({ actionId: z.string().min(1).max(256), positionals: z.array(z.string().max(16_384)).max(128), options: z.record(z.string(), z.union([z.string().max(16_384), z.boolean()])) }).strict() }).strict(),
]);

export const remoteControlSessionSchema = z.object({
  sessionId: z.string().uuid(),
  connectUrl: z.string().url(),
  expiresAt: z.string().datetime(),
  status: remoteControlStatusSchema,
  lastError: z.string().max(1_024).optional(),
}).strict();

export type RemoteControlStatus = z.infer<typeof remoteControlStatusSchema>;
export type RemoteEnvelope = z.infer<typeof remoteEnvelopeSchema>;
export type RemoteCommand = z.infer<typeof remoteCommandSchema>;
export type RemoteControlSession = z.infer<typeof remoteControlSessionSchema>;

export interface RemoteTaskSummary { id: string; title: string; status: TaskStatus; sessionId?: string; updatedAt: string }
export interface RemoteWorkspaceSummary { id: string; name: string; tasks: RemoteTaskSummary[] }
export interface RemoteAttachmentSummary { id: string; name: string; kind: string; size: number }
export interface RemoteCommandDescriptor { id: string; path: string[]; summary: string }
export interface RemoteTaskSnapshot { task: RemoteTaskSummary; activities: Activity[]; commands: RemoteCommandDescriptor[]; models: Array<{ id: string; label: string }>; attachments: Record<string, RemoteAttachmentSummary[]> }
export interface RemoteTrustRequest { trustRequestId: string; taskId: string; sessionId: string; path: string; cwd: string }
export interface RemoteControlSnapshot { generatedAt: string; workspaces: RemoteWorkspaceSummary[]; approvals: DesktopApprovalRequest[]; trustRequests: RemoteTrustRequest[]; task?: RemoteTaskSnapshot }
export interface RemoteControlStateEvent { type: 'state'; session: RemoteControlSession | null }

export interface DesktopRemoteControlApi {
  get(): Promise<RemoteControlSession | null>;
  create(): Promise<RemoteControlSession>;
  revoke(): Promise<void>;
  onState(listener: (event: RemoteControlStateEvent) => void): () => void;
}

export function remoteTaskSummary(task: Task): RemoteTaskSummary {
  return { id: task.id, title: task.title, status: task.status, ...(task.sessionId === undefined ? {} : { sessionId: task.sessionId }), updatedAt: task.updatedAt };
}

export function remoteWorkspaceSummary(workspace: Workspace, tasks: readonly Task[]): RemoteWorkspaceSummary {
  return { id: workspace.id, name: workspace.name, tasks: tasks.filter(task => !task.archived).map(remoteTaskSummary) };
}
