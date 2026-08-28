import { z } from 'zod';
import type { DesktopEvent } from '../../agent-protocol/v1/desktop.js';
import type { Automation, AutomationCreateInput, AutomationRun, AutomationStateEvent, AutomationUpdateInput } from './automation.js';
import type { DesktopSettingsSnapshot } from './settings.js';

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
export const DESKTOP_COMMAND_TIMING_METADATA_KEY = 'desktopCommandTiming' as const;
export interface DesktopCommandTiming { startedAt: number; endedAt: number }
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

export const trustRequestSchema = z.object({
  trustRequestId: z.string().min(1),
  taskId: z.string().min(1),
  sessionId: z.string().min(1),
  path: z.string().min(1),
});

export const agentEventEnvelopeSchema = z.object({
  cwd: z.string().min(1),
  event: z.object({
    version: z.literal(2),
    type: z.literal('event'),
    event: z.string().min(1),
    data: z.record(z.string(), z.unknown()),
  }),
});

export type Workspace = z.infer<typeof workspaceSchema>;
export type TaskStatus = z.infer<typeof taskStatusSchema>;
export type Task = z.infer<typeof taskSchema>;
export type Activity = z.infer<typeof activitySchema>;
export interface ActivityPage { activities: Activity[]; nextCursor: string | null; hasMore: boolean; }
export type Artifact = z.infer<typeof artifactSchema>;
export interface ArtifactPreview { artifact: Artifact; content?: string; dataUrl?: string; }
export interface ArtifactMedia { artifact: Artifact; mimeType: string; bytes: Uint8Array; }
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
  activitiesPage(taskId: string, options?: { limit?: number; before?: string }): Promise<ActivityPage>;
  artifacts(taskId: string): Promise<Artifact[]>;
  pickArtifact(taskId: string): Promise<Artifact | null>;
  importArtifact(taskId: string, sourcePath: string): Promise<Artifact>;
  createTextArtifact(taskId: string, name: string, content: string, kind?: 'text' | 'markdown' | 'patch' | 'json'): Promise<Artifact>;
  createImageArtifact(taskId: string, name: string, bytes: Uint8Array): Promise<Artifact>;
  deleteArtifact(taskId: string, artifactId: string, confirmed: boolean): Promise<void>;
  previewArtifact(taskId: string, artifactId: string): Promise<ArtifactPreview>;
  readArtifactMedia(taskId: string, artifactId: string): Promise<ArtifactMedia>;
  downloadArtifact(taskId: string, artifactId: string): Promise<string | null>;
  openArtifact(taskId: string, artifactId: string): Promise<string>;
}

export interface DesktopGitApi {
  status(cwd: string): Promise<GitRepositorySnapshot>;
  diff(cwd: string, staged?: boolean): Promise<string>;
  fileDiff(cwd: string, path: string, staged?: boolean): Promise<string>;
  readFile(cwd: string, path: string): Promise<string>;
  branches(cwd: string): Promise<string[]>;
  branchList(cwd: string): Promise<GitBranch[]>;
  stage(cwd: string, path: string): Promise<void>;
  stageAll(cwd: string): Promise<void>;
  unstage(cwd: string, path: string): Promise<void>;
  unstageAll(cwd: string): Promise<void>;
  commit(cwd: string, message: string): Promise<Record<string, unknown>>;
  createBranch(cwd: string, branch: string): Promise<void>;
  checkout(cwd: string, branch: string, confirmed: boolean): Promise<void>;
  fetch(cwd: string): Promise<GitOperationResult>;
  pull(cwd: string): Promise<GitOperationResult>;
  push(cwd: string, confirmed: boolean): Promise<GitOperationResult>;
  history(cwd: string, limit?: number): Promise<GitCommit[]>;
  stashList(cwd: string): Promise<GitStash[]>;
  stashSave(cwd: string, message?: string): Promise<GitOperationResult>;
  stashApply(cwd: string, reference: string): Promise<GitOperationResult>;
  stashDrop(cwd: string, reference: string, confirmed: boolean): Promise<GitOperationResult>;
  exportPatch(cwd: string, staged?: boolean): Promise<string>;
  worktreeAdd(cwd: string, worktreePath: string, branch: string): Promise<Record<string, unknown>>;
  worktreeRemove(cwd: string, worktreePath: string, confirmed: boolean): Promise<void>;
  restore(cwd: string, path: string, confirmed: boolean): Promise<void>;
}

export type GitFileStatus = 'modified' | 'added' | 'deleted' | 'renamed' | 'copied' | 'untracked' | 'conflicted' | 'ignored';
export interface GitFileChange { path: string; originalPath?: string; status: GitFileStatus; indexStatus: string; worktreeStatus: string; staged: boolean; unstaged: boolean; binary: boolean; directory?: boolean; }
export interface GitRepositorySnapshot { root: string; repositoryName: string; branch?: string; detached: boolean; upstream?: string; ahead: number; behind: number; clean: boolean; conflicts: number; changes: GitFileChange[]; exitCode: number; stderr: string; updatedAt: string; }
export interface GitBranch { name: string; current: boolean; remote: boolean; upstream?: string; ahead: number; behind: number; }
export interface GitCommit { hash: string; shortHash: string; subject: string; author: string; authoredAt: string; parents: string[]; }
export interface GitStash { reference: string; message: string; }
export interface GitOperationResult { output: string; exitCode: number; stderr: string; }

export interface DesktopTerminalApi {
  execute(input: TerminalExecutionInput): Promise<Record<string, unknown>>;
  list(taskId?: string): Promise<Record<string, unknown>[]>;
  open(input: TerminalSessionOpenInput): Promise<TerminalSession>;
  write(sessionId: string, data: string): Promise<void>;
  resize(sessionId: string, cols: number, rows: number): Promise<void>;
  close(sessionId: string): Promise<void>;
  onOutput(listener: (output: TerminalSessionOutput) => void): () => void;
}

export interface TerminalSession { id: string; cwd: string; shell: string; }
export interface TerminalSessionOutput { sessionId: string; data: string; }

export const terminalSessionOpenSchema = z.object({ cwd: z.string().min(1).max(4_096) });
export const terminalSessionResizeSchema = z.object({ sessionId: z.string().uuid(), cols: z.number().int().min(1).max(400), rows: z.number().int().min(1).max(200) });
export const terminalSessionWriteSchema = z.object({ sessionId: z.string().uuid(), data: z.string().min(1).max(128 * 1024) });
export const terminalSessionIdSchema = z.string().uuid();
export type TerminalSessionOpenInput = z.infer<typeof terminalSessionOpenSchema>;
export type TerminalSessionResizeInput = z.infer<typeof terminalSessionResizeSchema>;

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
  get(): Promise<DesktopSettingsSnapshot>;
  update(patch: Partial<DesktopSettingsSnapshot>): Promise<DesktopSettingsSnapshot>;
}

export interface DesktopAutomationApi {
  list(): Promise<Automation[]>;
  get(id: string): Promise<Automation>;
  create(input: AutomationCreateInput): Promise<Automation>;
  update(id: string, patch: AutomationUpdateInput): Promise<Automation>;
  remove(id: string): Promise<void>;
  run(id: string): Promise<AutomationRun>;
  pause(id: string): Promise<Automation>;
  resume(id: string): Promise<Automation>;
  cancel(runId: string): Promise<AutomationRun>;
  retry(runId: string): Promise<AutomationRun>;
  review(runId: string, approved: boolean): Promise<AutomationRun>;
  approvalRespond(runId: string, approvalId: string, approved: boolean): Promise<AutomationRun>;
  runs(automationId: string, limit?: number): Promise<AutomationRun[]>;
  onState(listener: (event: AutomationStateEvent) => void): () => void;
}

export interface BrowserConsoleEntry { level: string; message: string; timestamp: string; }
export interface BrowserEvidence { id: string; url: string; title: string; console: BrowserConsoleEntry[]; errors: string[]; screenshots: string[]; recordings: string[]; createdAt: string; }
export interface BrowserViewBounds { x: number; y: number; width: number; height: number; }
export interface BrowserTabSnapshot { id: string; title: string; url: string; loading: boolean; canGoBack: boolean; canGoForward: boolean; }
export interface BrowserSessionSnapshot { id: string; activeTabId: string; tabs: BrowserTabSnapshot[]; createdAt: string; }
export interface DesktopBrowserApi {
  create(): Promise<BrowserSessionSnapshot>;
  open(url: string, approved: boolean): Promise<{ id: string; url: string }>;
  close(sessionId: string): Promise<void>;
  createTab(sessionId: string): Promise<BrowserTabSnapshot>;
  closeTab(sessionId: string, tabId: string): Promise<void>;
  selectTab(sessionId: string, tabId: string): Promise<BrowserSessionSnapshot>;
  navigate(sessionId: string, tabId: string, url: string, approved: boolean): Promise<BrowserTabSnapshot>;
  goBack(sessionId: string, tabId: string): Promise<BrowserTabSnapshot>;
  goForward(sessionId: string, tabId: string): Promise<BrowserTabSnapshot>;
  reload(sessionId: string, tabId: string): Promise<BrowserTabSnapshot>;
  setViewBounds(sessionId: string, tabId: string, bounds: BrowserViewBounds, visible: boolean): Promise<void>;
  screenshot(sessionId: string, tabId?: string): Promise<{ evidenceId: string; path: string; dataUrl: string }>;
  startRecording(id: string): Promise<void>;
  stopRecording(id: string): Promise<BrowserEvidence>;
  list(): Promise<BrowserSessionSnapshot[]>;
  evidence(id: string): Promise<BrowserEvidence>;
  onState(listener: (snapshot: BrowserSessionSnapshot) => void): () => void;
}
