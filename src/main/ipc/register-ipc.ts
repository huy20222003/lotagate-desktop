import { dialog, ipcMain, shell } from 'electron';
import { z } from 'zod';
import type { DesktopAuthApi, LoginInput } from '../../contracts/ipc/v1/auth.js';
import type { DesktopUserContextService } from '../api/desktop-user-context-service.js';
import type { AgentManager } from '../agents/agent-manager.js';
import type { WorkspaceRegistry } from '../workspaces/workspace-registry.js';
import type { TaskStore } from '../tasks/task-store.js';
import type { GitService } from '../git/git-service.js';
import type { TerminalService } from '../terminal/terminal-service.js';
import type { SettingsService } from '../settings/settings-service.js';
import type { ArtifactService } from '../artifacts/artifact-service.js';
import type { BrowserService } from '../browser/browser-service.js';
import type { AutomationService } from '../automation/automation-service.js';
import type { Automation } from '../automation/automation-service.js';
import type { DesktopOperations } from '../operations/desktop-operations.js';
import { assertTrustedRenderer } from './sender-policy.js';

const cwdSchema = z.string().min(1).max(4_096);

export interface DesktopIpcServices {
  auth: DesktopAuthApi;
  userContext: DesktopUserContextService;
  agents: AgentManager;
  workspaces: WorkspaceRegistry;
  tasks: TaskStore;
  git: GitService;
  terminal: TerminalService;
  settings: SettingsService;
  artifacts: ArtifactService;
  browser: BrowserService;
  automations: AutomationService;
  operations: DesktopOperations;
  runAutomation(id: string): Promise<Automation>;
}

export function registerIpc(services: DesktopIpcServices): void {
  const { auth, userContext, agents, workspaces, tasks, git, terminal, settings, artifacts, browser, automations, operations, runAutomation } = services;
  ipcMain.handle('auth.getCurrentUser', async (event) => {
    assertTrustedRenderer(event);
    return auth.getCurrentUser();
  });
  ipcMain.handle('auth.login', async (event, input: LoginInput) => {
    assertTrustedRenderer(event);
    return auth.login(input);
  });
  ipcMain.handle('auth.logout', async (event) => {
    assertTrustedRenderer(event);
    return auth.logout();
  });
  ipcMain.handle('userContext.organizations', async event => { assertTrustedRenderer(event); return userContext.organizations(); });
  ipcMain.handle('userContext.organization', async (event, code: unknown) => { assertTrustedRenderer(event); return userContext.organization(idSchema.parse(code)); });
  ipcMain.handle('userContext.workspaces', async (event, code: unknown) => { assertTrustedRenderer(event); return userContext.workspaces(idSchema.parse(code)); });
  ipcMain.handle('userContext.models', async (event, organizationCode: unknown, workspaceCode: unknown) => { assertTrustedRenderer(event); return userContext.models(idSchema.parse(organizationCode), idSchema.parse(workspaceCode)); });
  ipcMain.handle('runtime.getVersion', async (event) => {
    assertTrustedRenderer(event);
    return process.env['npm_package_version'] ?? '0.1.0';
  });
  ipcMain.handle('agent.initialize', async (event, cwd: unknown) => {
    assertTrustedRenderer(event);
    return agents.initialize(cwdSchema.parse(cwd));
  });
  ipcMain.handle('agent.shutdown', async (event, cwd: unknown) => {
    assertTrustedRenderer(event);
    await agents.shutdown(cwdSchema.parse(cwd));
  });
  ipcMain.handle('agent.sessionCreate', async (event, cwd: unknown, input: unknown) => { assertTrustedRenderer(event); return agents.sessionCreate(cwdSchema.parse(cwd), objectSchema.parse(input) as { model?: string; name?: string }); });
  ipcMain.handle('agent.sessionList', async (event, cwd: unknown) => { assertTrustedRenderer(event); return agents.sessionList(cwdSchema.parse(cwd)); });
  ipcMain.handle('agent.sessionResume', async (event, cwd: unknown, sessionId: unknown) => { assertTrustedRenderer(event); return agents.sessionResume(cwdSchema.parse(cwd), idSchema.parse(sessionId)); });
  ipcMain.handle('agent.turnStart', async (event, cwd: unknown, input: unknown) => { assertTrustedRenderer(event); return agents.turnStart(cwdSchema.parse(cwd), objectSchema.parse(input) as { sessionId: string; prompt: string; model?: string }); });
  ipcMain.handle('agent.turnCancel', async (event, cwd: unknown, turnId: unknown) => { assertTrustedRenderer(event); return agents.turnCancel(cwdSchema.parse(cwd), idSchema.parse(turnId)); });
  ipcMain.handle('agent.approvalRespond', async (event, cwd: unknown, input: unknown) => { assertTrustedRenderer(event); return agents.approvalRespond(cwdSchema.parse(cwd), objectSchema.parse(input) as { approvalId: string; approved: boolean }); });
  ipcMain.handle('agent.trustRespond', async (event, cwd: unknown, input: unknown) => { assertTrustedRenderer(event); return agents.trustRespond(cwdSchema.parse(cwd), objectSchema.parse(input) as { trustRequestId: string; trusted: boolean }); });
  ipcMain.handle('agent.modelList', async (event, cwd: unknown) => { assertTrustedRenderer(event); return agents.modelList(cwdSchema.parse(cwd)); });
  ipcMain.handle('agent.commandList', async (event, cwd: unknown) => { assertTrustedRenderer(event); return agents.commandList(cwdSchema.parse(cwd)); });
  ipcMain.handle('agent.commandExecute', async (event, cwd: unknown, input: unknown) => { assertTrustedRenderer(event); return agents.commandExecute(cwdSchema.parse(cwd), objectSchema.parse(input)); });
  ipcMain.handle('agent.commandCancel', async (event, cwd: unknown, commandId: unknown) => { assertTrustedRenderer(event); return agents.commandCancel(cwdSchema.parse(cwd), idSchema.parse(commandId)); });
  ipcMain.handle('workspace.list', async event => { assertTrustedRenderer(event); return workspaces.list(); });
  ipcMain.handle('workspace.add', async (event, rootPath: unknown) => { assertTrustedRenderer(event); return workspaces.add(cwdSchema.parse(rootPath)); });
  ipcMain.handle('workspace.addRoot', async (event, workspaceId: unknown, rootPath: unknown) => { assertTrustedRenderer(event); return workspaces.addRoot(idSchema.parse(workspaceId), cwdSchema.parse(rootPath)); });
  ipcMain.handle('workspace.rename', async (event, workspaceId: unknown, name: unknown) => { assertTrustedRenderer(event); return workspaces.rename(idSchema.parse(workspaceId), z.string().parse(name)); });
  ipcMain.handle('workspace.reorder', async (event, ids: unknown) => { assertTrustedRenderer(event); return workspaces.reorder(z.array(idSchema).parse(ids)); });
  ipcMain.handle('workspace.settings', async (event, workspaceId: unknown, patch: unknown) => { assertTrustedRenderer(event); return workspaces.updateSettings(idSchema.parse(workspaceId), objectSchema.parse(patch)); });
  ipcMain.handle('workspace.remove', async (event, workspaceId: unknown) => { assertTrustedRenderer(event); return workspaces.remove(idSchema.parse(workspaceId)); });
  ipcMain.handle('workspace.trust', async (event, workspaceId: unknown, trusted: unknown) => { assertTrustedRenderer(event); return workspaces.trust(idSchema.parse(workspaceId), z.boolean().parse(trusted)); });
  ipcMain.handle('task.list', async (event, workspaceId?: unknown) => { assertTrustedRenderer(event); return tasks.list(workspaceId === undefined ? undefined : idSchema.parse(workspaceId)); });
  ipcMain.handle('task.create', async (event, input: unknown) => {
    assertTrustedRenderer(event);
    const value = objectSchema.parse(input);
    const workspaceId = idSchema.parse(value['workspaceId']);
    const workspace = await workspaces.require(workspaceId);
    return tasks.create({ workspaceId, cwd: workspace.rootPath, title: z.string().min(1).parse(value['title']), ...(value['prompt'] === undefined ? {} : { prompt: z.string().parse(value['prompt']) }) });
  });
  ipcMain.handle('task.update', async (event, taskId: unknown, patch: unknown) => { assertTrustedRenderer(event); return tasks.update(idSchema.parse(taskId), objectSchema.parse(patch)); });
  ipcMain.handle('task.status', async (event, taskId: unknown, status: unknown) => { assertTrustedRenderer(event); return tasks.setStatus(idSchema.parse(taskId), z.enum(['queued', 'active', 'completed', 'failed', 'cancelled', 'paused', 'interrupted']).parse(status)); });
  ipcMain.handle('task.retry', async (event, taskId: unknown) => { assertTrustedRenderer(event); return tasks.retry(idSchema.parse(taskId)); });
  ipcMain.handle('task.cancel', async (event, taskId: unknown) => { assertTrustedRenderer(event); return tasks.cancel(idSchema.parse(taskId)); });
  ipcMain.handle('task.resume', async (event, taskId: unknown) => { assertTrustedRenderer(event); return tasks.resume(idSchema.parse(taskId)); });
  ipcMain.handle('task.archive', async (event, taskId: unknown, archived: unknown) => { assertTrustedRenderer(event); return tasks.archive(idSchema.parse(taskId), z.boolean().parse(archived)); });
  ipcMain.handle('task.pin', async (event, taskId: unknown, pinned: unknown) => { assertTrustedRenderer(event); return tasks.pin(idSchema.parse(taskId), z.boolean().parse(pinned)); });
  ipcMain.handle('task.activity', async (event, taskId: unknown, kind: unknown, text: unknown, metadata?: unknown) => { assertTrustedRenderer(event); return tasks.appendActivity(idSchema.parse(taskId), z.enum(['user', 'assistant', 'tool', 'command', 'file', 'approval', 'trust', 'usage', 'context', 'error', 'verification']).parse(kind), z.string().parse(text), metadata === undefined ? {} : objectSchema.parse(metadata)); });
  ipcMain.handle('task.activities', async (event, taskId: unknown) => { assertTrustedRenderer(event); return tasks.activities(idSchema.parse(taskId)); });
  ipcMain.handle('task.artifacts', async (event, taskId: unknown) => { assertTrustedRenderer(event); return artifacts.list(idSchema.parse(taskId)); });
  ipcMain.handle('task.pickArtifact', async (event, taskId: unknown) => { assertTrustedRenderer(event); const selected = await dialog.showOpenDialog({ properties: ['openFile'] }); if (selected.canceled || selected.filePaths[0] === undefined) return null; return artifacts.importFile(idSchema.parse(taskId), selected.filePaths[0], artifactKind(selected.filePaths[0])); });
  ipcMain.handle('task.createTextArtifact', async (event, taskId: unknown, name: unknown, content: unknown, kind?: unknown) => { assertTrustedRenderer(event); return artifacts.createText(idSchema.parse(taskId), z.string().min(1).max(200).parse(name), z.string().max(8 * 1024 * 1024).parse(content), kind === undefined ? 'text' : z.enum(['text', 'markdown', 'patch', 'json']).parse(kind)); });
  ipcMain.handle('task.deleteArtifact', async (event, taskId: unknown, artifactId: unknown, confirmed: unknown) => { assertTrustedRenderer(event); return artifacts.delete(idSchema.parse(taskId), idSchema.parse(artifactId), z.boolean().parse(confirmed)); });
  ipcMain.handle('task.previewArtifact', async (event, taskId: unknown, artifactId: unknown) => { assertTrustedRenderer(event); return artifacts.preview(idSchema.parse(taskId), idSchema.parse(artifactId)); });
  ipcMain.handle('task.openArtifact', async (event, taskId: unknown, artifactId: unknown) => { assertTrustedRenderer(event); const path = await artifacts.path(idSchema.parse(taskId), idSchema.parse(artifactId)); return shell.openPath(path); });
  ipcMain.handle('git.status', async (event, cwd: unknown) => { assertTrustedRenderer(event); return git.status(cwdSchema.parse(cwd)); });
  ipcMain.handle('git.diff', async (event, cwd: unknown, staged?: unknown) => { assertTrustedRenderer(event); return git.diff(cwdSchema.parse(cwd), staged === undefined ? false : z.boolean().parse(staged)); });
  ipcMain.handle('git.branches', async (event, cwd: unknown) => { assertTrustedRenderer(event); return git.branches(cwdSchema.parse(cwd)); });
  ipcMain.handle('git.stage', async (event, cwd: unknown, path: unknown) => { assertTrustedRenderer(event); return git.stage(cwdSchema.parse(cwd), cwdSchema.parse(path)); });
  ipcMain.handle('git.unstage', async (event, cwd: unknown, path: unknown) => { assertTrustedRenderer(event); return git.unstage(cwdSchema.parse(cwd), cwdSchema.parse(path)); });
  ipcMain.handle('git.commit', async (event, cwd: unknown, message: unknown) => { assertTrustedRenderer(event); return git.commit(cwdSchema.parse(cwd), z.string().parse(message)); });
  ipcMain.handle('git.createBranch', async (event, cwd: unknown, branch: unknown) => { assertTrustedRenderer(event); return git.createBranch(cwdSchema.parse(cwd), z.string().parse(branch)); });
  ipcMain.handle('git.exportPatch', async (event, cwd: unknown, staged?: unknown) => { assertTrustedRenderer(event); return git.exportPatch(cwdSchema.parse(cwd), staged === undefined ? false : z.boolean().parse(staged)); });
  ipcMain.handle('git.worktreeAdd', async (event, cwd: unknown, path: unknown, branch: unknown) => { assertTrustedRenderer(event); return git.worktreeAdd(cwdSchema.parse(cwd), cwdSchema.parse(path), cwdSchema.parse(branch)); });
  ipcMain.handle('git.worktreeRemove', async (event, cwd: unknown, path: unknown, confirmed: unknown) => { assertTrustedRenderer(event); return git.worktreeRemove(cwdSchema.parse(cwd), cwdSchema.parse(path), z.boolean().parse(confirmed)); });
  ipcMain.handle('git.restore', async (event, cwd: unknown, path: unknown, confirmed: unknown) => { assertTrustedRenderer(event); return git.restore(cwdSchema.parse(cwd), cwdSchema.parse(path), z.boolean().parse(confirmed)); });
  ipcMain.handle('terminal.execute', async (event, input: unknown) => {
    assertTrustedRenderer(event);
    const value = objectSchema.parse(input) as { cwd: string; command: string; args: string[]; timeoutMs?: number; taskId?: string };
    const result = await terminal.execute(value);
    if (value.taskId) await tasks.appendActivity(value.taskId, 'verification', `${value.command} ${value.args.join(' ')}`.trim(), { cwd: result.cwd, exitCode: result.exitCode, durationMs: result.durationMs, truncated: result.truncated, evidenceId: result.id, output: `${result.stdout}\n${result.stderr}`.slice(0, 4_096) });
    return result;
  });
  ipcMain.handle('terminal.list', async (event, taskId?: unknown) => { assertTrustedRenderer(event); return terminal.list(taskId === undefined ? undefined : idSchema.parse(taskId)); });
  ipcMain.handle('settings.get', async event => { assertTrustedRenderer(event); return settings.get(); });
  ipcMain.handle('settings.update', async (event, patch: unknown) => { assertTrustedRenderer(event); return settings.update(objectSchema.parse(patch)); });
  ipcMain.handle('browser.open', async (event, url: unknown, approved: unknown) => { assertTrustedRenderer(event); return browser.open(z.string().url().parse(url), z.boolean().parse(approved)); });
  ipcMain.handle('browser.close', async (event, id: unknown) => { assertTrustedRenderer(event); return browser.close(idSchema.parse(id)); });
  ipcMain.handle('browser.screenshot', async (event, id: unknown) => { assertTrustedRenderer(event); return browser.screenshot(idSchema.parse(id)); });
  ipcMain.handle('browser.startRecording', async (event, id: unknown) => { assertTrustedRenderer(event); return browser.startRecording(idSchema.parse(id)); });
  ipcMain.handle('browser.stopRecording', async (event, id: unknown) => { assertTrustedRenderer(event); return browser.stopRecording(idSchema.parse(id)); });
  ipcMain.handle('browser.list', async event => { assertTrustedRenderer(event); return browser.list(); });
  ipcMain.handle('browser.evidence', async (event, id: unknown) => { assertTrustedRenderer(event); return browser.evidence(idSchema.parse(id)); });
  ipcMain.handle('automation.list', async event => { assertTrustedRenderer(event); return automations.list(); });
  ipcMain.handle('automation.create', async (event, input: unknown) => { assertTrustedRenderer(event); return automations.create(objectSchema.parse(input) as never); });
  ipcMain.handle('automation.update', async (event, id: unknown, patch: unknown) => { assertTrustedRenderer(event); return automations.update(idSchema.parse(id), objectSchema.parse(patch)); });
  ipcMain.handle('automation.remove', async (event, id: unknown) => { assertTrustedRenderer(event); return automations.remove(idSchema.parse(id)); });
  ipcMain.handle('automation.run', async (event, id: unknown) => { assertTrustedRenderer(event); return runAutomation(idSchema.parse(id)); });
  ipcMain.handle('operations.notify', async (event, title: unknown, body: unknown) => { assertTrustedRenderer(event); operations.notify(z.string().min(1).parse(title), z.string().max(2_000).parse(body)); });
  ipcMain.handle('operations.showWindow', async event => { assertTrustedRenderer(event); operations.showWindow(); });
  ipcMain.handle('operations.exportDiagnostics', async event => { assertTrustedRenderer(event); return operations.exportDiagnostics({ version: process.env['npm_package_version'] ?? '0.1.0', settings: await settings.get() }); });
  ipcMain.handle('operations.checkForUpdates', async event => { assertTrustedRenderer(event); return operations.checkForUpdates(process.env['LOTAGATE_UPDATE_MANIFEST_URL']?.trim() ?? ''); });
}

const idSchema = z.string().min(1).max(256);
const objectSchema = z.record(z.string(), z.unknown());
function artifactKind(path: string): 'markdown' | 'text' | 'image' | 'audio' | 'video' | 'patch' | 'json' | 'binary' { const extension = path.split('.').pop()?.toLowerCase(); if (extension === 'md' || extension === 'markdown') return 'markdown'; if (extension === 'json') return 'json'; if (extension === 'patch' || extension === 'diff') return 'patch'; if (['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(extension ?? '')) return 'image'; if (['mp3', 'wav', 'm4a'].includes(extension ?? '')) return 'audio'; if (['mp4', 'webm', 'mov'].includes(extension ?? '')) return 'video'; if (['txt', 'log', 'csv'].includes(extension ?? '')) return 'text'; return 'binary'; }
