import type { Automation, AutomationExecutionResult } from './automation-service.js';
import type { AutomationRun } from '../../contracts/ipc/v1/automation.js';
import type { ArtifactService } from '../artifacts/artifact-service.js';
import { artifactKind } from '../artifacts/artifact-kind.js';
import type { AgentManager } from '../agents/agent-manager.js';
import type { BrowserHostToolBroker } from '../agents/browser-host-tool-broker.js';
import { buildAutomationExecutionPolicy, supportsAutomationExecution } from './automation-execution-policy.js';
import { prepareAutomationWorkspace } from './automation-workspace.js';
import type { GitService } from '../git/git-service.js';
import type { DesktopLogger } from '../observability/desktop-logger.js';
import type { SettingsService } from '../settings/settings-service.js';
import { finalAutomationSummary } from './automation-output.js';
import type { TaskStore } from '../tasks/task-store.js';
import type { WorkspaceRegistry } from '../workspaces/workspace-registry.js';
import { requireExistingPath } from '../security/path-policy.js';

export interface AutomationExecutionDependencies {
  workspaces: WorkspaceRegistry;
  git: GitService;
  tasks: TaskStore;
  agents: AgentManager;
  settings: SettingsService;
  browserHost: BrowserHostToolBroker;
  artifacts: ArtifactService;
  logger: DesktopLogger;
  sessions: Map<string, { runId: string; cwd: string }>;
}

export class AutomationExecutionService {
  constructor(private readonly dependencies: AutomationExecutionDependencies) {}

  async execute(automation: Automation, run: AutomationRun, signal: AbortSignal): Promise<AutomationExecutionResult> {
    const { workspaces, git, tasks, agents, settings, browserHost, artifacts, logger, sessions } = this.dependencies;
    const workspace = await workspaces.require(automation.workspaceId);
    if (!workspace.trusted) throw new Error('Trust the automation workspace before running it.');
    const executionWorkspace = await prepareAutomationWorkspace(git, workspace, automation, run.id);
    let preserveWorkspace = true;
    const task = await tasks.create({ workspaceId: workspace.id, cwd: executionWorkspace.cwd, title: automation.name, titleSource: 'manual', prompt: automation.prompt });
    const cli = await agents.initialize(executionWorkspace.cwd);
    const execution = buildAutomationExecutionPolicy(automation, run.attempt, (await settings.get()).sandbox.hostFallback);
    if (!supportsAutomationExecution(cli.capabilities)) throw new Error('The installed CLI does not support the required Desktop execution protocol. Update the Desktop CLI runtime before running this automation.');
    const session = await agents.sessionCreate(executionWorkspace.cwd, { name: task.title });
    const sessionId = extractSessionId(session);
    if (sessionId === undefined) throw new Error('Automation could not create a CLI session.');
    sessions.set(sessionId, { runId: run.id, cwd: executionWorkspace.cwd });
    await tasks.update(task.id, { sessionId });
    const cancelTurn = () => { void cancelTaskTurn(agents, tasks, executionWorkspace.cwd, task.id); };
    signal.addEventListener('abort', cancelTurn, { once: true });
    browserHost.setRunPolicy(run.id, automation.browserAccess);
    browserHost.bindSessionToRun(executionWorkspace.cwd, sessionId, run.id);
    try {
      await agents.turnStart(executionWorkspace.cwd, { sessionId, prompt: automation.prompt, ...(automation.model === undefined ? {} : { model: automation.model }), runId: run.id, taskId: task.id, skills: automation.skills, execution });
      const completedTask = await waitForAutomationTask(tasks, task.id, signal);
      const outputs = await collectAutomationOutputs(tasks, artifacts, task.id, executionWorkspace.cwd);
      preserveWorkspace = automation.permissionPolicy === 'review';
      return { taskId: completedTask.id, sessionId, executionCwd: executionWorkspace.cwd, ...(executionWorkspace.branch === undefined ? {} : { branch: executionWorkspace.branch }), ...(executionWorkspace.worktreePath === undefined ? {} : { worktreePath: executionWorkspace.worktreePath }), ...outputs, ...(outputs.summary === undefined && completedTask.status === 'completed' ? { summary: 'Automation completed successfully.' } : {}), reviewRequired: automation.permissionPolicy === 'review' };
    } finally {
      signal.removeEventListener('abort', cancelTurn);
      if (!automation.keepSession) await browserHost.closeRun(run.id);
      else browserHost.clearRunPolicy(run.id);
      sessions.delete(sessionId);
      await executionWorkspace.cleanup(preserveWorkspace).catch(error => logger.warn('automation.worktree.cleanup.failed', { runId: run.id, message: error instanceof Error ? error.message : 'Unable to clean automation worktree.' }));
    }
  }
}

function extractSessionId(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const session = (value as Record<string, unknown>)['session'];
  if (typeof session !== 'object' || session === null) return undefined;
  const id = (session as Record<string, unknown>)['id'];
  return typeof id === 'string' ? id : undefined;
}

async function waitForAutomationTask(tasks: TaskStore, taskId: string, signal: AbortSignal): Promise<Awaited<ReturnType<TaskStore['require']>>> {
  while (true) {
    if (signal.aborted) throw new Error('Automation run was cancelled.');
    const task = await tasks.require(taskId);
    if (task.status === 'completed') return task;
    if (task.status === 'failed' || task.status === 'interrupted') throw new Error(task.interruptedReason ?? 'The automation task failed.');
    if (task.status === 'cancelled') throw new Error('The automation task was cancelled.');
    await delay(250);
  }
}

function delay(milliseconds: number): Promise<void> { return new Promise(resolve => setTimeout(resolve, milliseconds)); }

async function collectAutomationOutputs(tasks: TaskStore, artifacts: ArtifactService, taskId: string, cwd: string): Promise<{ summary?: string; changedFiles: string[]; artifactIds: string[] }> {
  const activities = await tasks.activities(taskId);
  const changedFiles = [...new Set(activities.flatMap(activity => {
    const change = activity.metadata['change'];
    if (typeof change !== 'object' || change === null || Array.isArray(change)) return [];
    const path = (change as Record<string, unknown>)['path'];
    return typeof path === 'string' && path.length > 0 ? [path] : [];
  }))];
  for (const changedFile of changedFiles) {
    const sourcePath = await requireExistingPath(changedFile, cwd).catch(() => undefined);
    if (sourcePath === undefined) continue;
    await artifacts.importFile(taskId, sourcePath, artifactKind(sourcePath)).catch(() => undefined);
  }
  const artifactIds = (await artifacts.list(taskId)).map(artifact => artifact.id);
  const summary = finalAutomationSummary(activities);
  return { changedFiles, artifactIds, ...(summary === undefined ? {} : { summary }) };
}

async function cancelTaskTurn(agents: AgentManager, tasks: TaskStore, cwd: string, taskId: string): Promise<void> {
  const task = await tasks.require(taskId).catch(() => undefined);
  if (task?.turnId !== undefined) await agents.turnCancel(cwd, task.turnId).catch(() => undefined);
}
