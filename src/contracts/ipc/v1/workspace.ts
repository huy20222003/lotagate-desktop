import { z } from 'zod';
import type { DesktopEvent } from '../../agent-protocol/v1/desktop.js';

export const workspaceSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  rootPath: z.string().min(1),
  gitRoot: z.string().optional(),
  roots: z.array(z.string().min(1)).min(1),
  trusted: z.boolean(),
  createdAt: z.string().datetime(),
  lastOpenedAt: z.string().datetime(),
  settings: z.record(z.string(), z.unknown()).default({}),
});

export const taskStatusSchema = z.enum(['queued', 'active', 'completed', 'failed', 'cancelled', 'paused', 'interrupted']);
export const DESKTOP_TURN_TIMING_METADATA_KEY = 'desktopTurnTiming' as const;
export type DesktopTurnTimingPhase = 'started' | 'completed' | 'failed' | 'cancelled';
export interface DesktopTurnTimingMarker { phase: DesktopTurnTimingPhase; timestampMs: number }
export const taskSchema = z.object({
  id: z.string().min(1),
  workspaceId: z.string().min(1),
  title: z.string().min(1),
  cwd: z.string().min(1),
  status: taskStatusSchema,
  sessionId: z.string().optional(),
  turnId: z.string().optional(),
  model: z.string().optional(),
  lastEventCursor: z.number().int().nonnegative().default(0),
  interruptedReason: z.string().optional(),
  pinned: z.boolean(),
  archived: z.boolean(),
  draft: z.string(),
  draftAttachmentIds: z.array(z.string().min(1)).default([]),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const activitySchema = z.object({
  id: z.string().min(1),
  taskId: z.string().min(1),
  kind: z.enum(['user', 'assistant', 'tool', 'command', 'file', 'approval', 'trust', 'usage', 'context', 'error', 'verification']),
  text: z.string(),
  metadata: z.record(z.string(), z.unknown()),
  createdAt: z.string().datetime(),
});

export const artifactSchema = z.object({
  id: z.string().min(1),
  taskId: z.string().min(1),
  name: z.string().min(1),
  path: z.string().min(1),
  kind: z.enum(['markdown', 'text', 'image', 'audio', 'video', 'patch', 'json', 'binary']),
  size: z.number().nonnegative(),
  createdAt: z.string().datetime(),
  deletedAt: z.string().datetime().optional(),
});

export const approvalRequestSchema = z.object({
  approvalId: z.string().min(1),
  taskId: z.string().min(1),
  turnId: z.string().min(1),
  toolName: z.string().min(1),
  displayName: z.string().min(1),
  kind: z.string().min(1),
  detail: z.record(z.string(), z.unknown()),
});

export const trustRequestSchema = z.object({
  trustRequestId: z.string().min(1),
  taskId: z.string().min(1),
  sessionId: z.string().min(1),
  path: z.string().min(1),
});

export const agentEventEnvelopeSchema = z.object({
  cwd: z.string().min(1),
  event: z.object({
    version: z.literal(1),
    type: z.literal('event'),
    event: z.string().min(1),
    data: z.record(z.string(), z.unknown()),
  }),
});

export type Workspace = z.infer<typeof workspaceSchema>;
export type TaskStatus = z.infer<typeof taskStatusSchema>;
export type Task = z.infer<typeof taskSchema>;
export type Activity = z.infer<typeof activitySchema>;
export type Artifact = z.infer<typeof artifactSchema>;
export type ApprovalRequest = z.infer<typeof approvalRequestSchema>;
export type TrustRequest = z.infer<typeof trustRequestSchema>;
export type AgentEventEnvelope = z.infer<typeof agentEventEnvelopeSchema>;
export type AgentEvent = DesktopEvent;

export type FileDiffLineKind = 'context' | 'addition' | 'deletion';
export interface FileDiffLine { kind: FileDiffLineKind; text: string; oldLine?: number; newLine?: number }
export interface FileChangeDiff { path: string; lines: FileDiffLine[]; additions: number; deletions: number; truncated: boolean }
export interface FileChangeSummary { files: FileChangeDiff[]; additions: number; deletions: number }
export type SubagentStatus = 'queued' | 'running' | 'completed' | 'completed_with_warning' | 'failed' | 'cancelled';
export interface SubagentHandoff { summary: string; filesInspected: string[]; filesChanged: string[]; commandsRun: string[]; verification: string[]; warnings: string[] }
export interface SubagentSnapshot { id: string; displayName: string; task: string; mode: 'research' | 'worker'; model: string; status: SubagentStatus; background: boolean; timestamp: number; durationMs?: number; summary?: string; lastAction?: { kind: string; label: string }; handoff?: SubagentHandoff }
export interface PlanStepSnapshot { index: number; id: string; title: string; description: string; status: 'queued' | 'started' | 'completed' }
export interface PlanSnapshot { id: string; goal: string; totalSteps: number; steps: PlanStepSnapshot[]; status: 'started' | 'completed' | 'failed'; currentStep?: number; error?: string }

export interface DesktopWorkspaceApi {
  list(): Promise<Workspace[]>;
  pickFolder(rootPath?: string): Promise<string | null>;
  pickFile(rootPath?: string, extensions?: string[]): Promise<string | null>;
  pickMultipleFile(rootPath?: string, extensions?: string[]): Promise<string[]>;
  fileSize(rootPath: string | undefined, filePath: string): Promise<number>;
  add(rootPath: string): Promise<Workspace>;
  addRoot(workspaceId: string, rootPath: string): Promise<Workspace>;
  rename(workspaceId: string, name: string): Promise<Workspace>;
  reorder(workspaceIds: string[]): Promise<Workspace[]>;
  updateSettings(workspaceId: string, patch: Record<string, unknown>): Promise<Workspace>;
  remove(workspaceId: string): Promise<void>;
  trust(workspaceId: string, trusted: boolean): Promise<Workspace>;
  fileSuggestions(rootPath: string, query: string): Promise<WorkspaceFileSuggestion[]>;
}

export interface WorkspaceFileSuggestion { path: string; kind: 'file' | 'folder' }

export interface DesktopTaskApi {
  list(workspaceId?: string): Promise<Task[]>;
  create(input: { workspaceId: string; title: string; prompt?: string }): Promise<Task>;
  update(taskId: string, patch: { title?: string; pinned?: boolean; archived?: boolean; draft?: string; draftAttachmentIds?: string[]; sessionId?: string; turnId?: string; model?: string; lastEventCursor?: number; interruptedReason?: string }): Promise<Task>;
  setStatus(taskId: string, status: TaskStatus): Promise<Task>;
  retry(taskId: string): Promise<Task>;
  cancel(taskId: string): Promise<Task>;
  resume(taskId: string): Promise<Task>;
  archive(taskId: string, archived: boolean): Promise<Task>;
  pin(taskId: string, pinned: boolean): Promise<Task>;
  addActivity(taskId: string, kind: Activity['kind'], text: string, metadata?: Record<string, unknown>): Promise<Activity>;
  activities(taskId: string): Promise<Activity[]>;
  artifacts(taskId: string): Promise<Artifact[]>;
  pickArtifact(taskId: string): Promise<Artifact | null>;
  createTextArtifact(taskId: string, name: string, content: string, kind?: 'text' | 'markdown' | 'patch' | 'json'): Promise<Artifact>;
  createImageArtifact(taskId: string, name: string, bytes: Uint8Array): Promise<Artifact>;
  deleteArtifact(taskId: string, artifactId: string, confirmed: boolean): Promise<void>;
  previewArtifact(taskId: string, artifactId: string): Promise<Record<string, unknown>>;
  openArtifact(taskId: string, artifactId: string): Promise<string>;
}

export interface DesktopGitApi {
  status(cwd: string): Promise<Record<string, unknown>>;
  diff(cwd: string, staged?: boolean): Promise<string>;
  readFile(cwd: string, path: string): Promise<string>;
  branches(cwd: string): Promise<string[]>;
  stage(cwd: string, path: string): Promise<void>;
  unstage(cwd: string, path: string): Promise<void>;
  commit(cwd: string, message: string): Promise<Record<string, unknown>>;
  createBranch(cwd: string, branch: string): Promise<void>;
  exportPatch(cwd: string, staged?: boolean): Promise<string>;
  worktreeAdd(cwd: string, worktreePath: string, branch: string): Promise<Record<string, unknown>>;
  worktreeRemove(cwd: string, worktreePath: string, confirmed: boolean): Promise<void>;
  restore(cwd: string, path: string, confirmed: boolean): Promise<void>;
}

export interface DesktopTerminalApi {
  execute(input: TerminalExecutionInput): Promise<Record<string, unknown>>;
  list(taskId?: string): Promise<Record<string, unknown>[]>;
}

export const terminalExecutionInputSchema = z.object({
  cwd: z.string().min(1).max(4_096),
  command: z.string().trim().min(1).max(512),
  args: z.array(z.string().max(16_384)).max(128),
  timeoutMs: z.number().int().min(100).max(10 * 60 * 1_000).optional(),
  taskId: z.string().min(1),
  approved: z.boolean().default(false),
});
export type TerminalExecutionInput = z.infer<typeof terminalExecutionInputSchema>;

export interface DesktopSettingsApi {
  get(): Promise<Record<string, unknown>>;
  update(patch: Record<string, unknown>): Promise<Record<string, unknown>>;
}

export interface DesktopAutomationApi {
  list(): Promise<Record<string, unknown>[]>;
  create(input: Record<string, unknown>): Promise<Record<string, unknown>>;
  update(id: string, patch: Record<string, unknown>): Promise<Record<string, unknown>>;
  remove(id: string): Promise<void>;
  run(id: string): Promise<Record<string, unknown>>;
}

export interface BrowserConsoleEntry { level: string; message: string; timestamp: string; }
export interface BrowserEvidence { id: string; url: string; title: string; console: BrowserConsoleEntry[]; errors: string[]; screenshots: string[]; recordings: string[]; createdAt: string; }
export interface DesktopBrowserApi {
  open(url: string, approved: boolean): Promise<{ id: string; url: string }>;
  close(id: string): Promise<void>;
  screenshot(id: string): Promise<{ evidenceId: string; path: string; dataUrl: string }>;
  startRecording(id: string): Promise<void>;
  stopRecording(id: string): Promise<BrowserEvidence>;
  list(): Promise<BrowserEvidence[]>;
  evidence(id: string): Promise<BrowserEvidence>;
}
