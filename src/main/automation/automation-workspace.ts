import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { Automation } from '../../contracts/ipc/v1/automation.js';
import type { AutomationRun } from '../../contracts/ipc/v1/automation.js';
import type { Workspace } from '../../contracts/ipc/v1/workspace.js';
import { desktopDataPath } from '../persistence/app-data-paths.js';
import { GitService } from '../git/git-service.js';

export interface PreparedAutomationWorkspace {
  cwd: string;
  branch?: string;
  worktreePath?: string;
  cleanup(preserve: boolean): Promise<void>;
}

/** Resolves the execution directory without ever switching the user's primary checkout. */
export async function prepareAutomationWorkspace(git: GitService, workspace: Workspace, automation: Automation, runId: string, managedRoot = desktopDataPath('automation-worktrees')): Promise<PreparedAutomationWorkspace> {
  if (!automation.worktree) {
    if (automation.branch !== undefined) throw new Error('An automation branch requires worktree isolation.');
    return { cwd: workspace.rootPath, cleanup: async () => undefined };
  }

  const gitRoot = workspace.gitRoot ?? workspace.rootPath;
  const branch = `automation/lotagate-${runId.replace(/[^A-Za-z0-9-]/gu, '').slice(0, 120) || randomUUID()}`;
  const worktreePath = join(managedRoot, runId);
  await git.automationWorktreeAdd(gitRoot, managedRoot, worktreePath, branch, automation.branch);

  let cleaned = false;
  return {
    cwd: worktreePath,
    branch,
    worktreePath,
    cleanup: async preserve => {
      if (cleaned || preserve) return;
      cleaned = true;
      await git.automationWorktreeRemove(gitRoot, managedRoot, worktreePath);
    },
  };
}

export async function cleanupAutomationWorkspace(git: GitService, workspace: Workspace, run: AutomationRun): Promise<void> {
  if (run.worktreePath === undefined) return;
  await git.automationWorktreeRemove(workspace.gitRoot ?? workspace.rootPath, desktopDataPath('automation-worktrees'), run.worktreePath);
}
