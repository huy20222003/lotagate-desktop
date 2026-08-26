import { dialog, shell } from 'electron';
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
import type { DesktopMenuContext } from '../windows/application-menu.js';
import type { WorkspaceFileSuggestions } from '../workspaces/workspace-file-suggestions.js';
import { terminalExecutionInputSchema } from '../../contracts/ipc/v1/workspace.js';
import { registerLoggedIpcHandler } from './logged-ipc.js';
import type { DesktopLogger } from '../observability/desktop-logger.js';
import type { ExtensionFileService } from '../extensions/extension-file-service.js';
import { extensionDetailInputSchema, extensionDetailWriteInputSchema, hookCreateInputSchema, hookRemoveInputSchema } from '../../contracts/ipc/v1/extensions-schema.js';

const cwdSchema = z.string().min(1).max(4_096);

export interface DesktopIpcServices {
  auth: DesktopAuthApi;
  userContext: DesktopUserContextService;
  agents: AgentManager;
  workspaces: WorkspaceRegistry;
  workspaceFileSuggestions: WorkspaceFileSuggestions;
  tasks: TaskStore;
  extensionFiles: ExtensionFileService;
  git: GitService;
  terminal: TerminalService;
  settings: SettingsService;
  artifacts: ArtifactService;
  browser: BrowserService;
  automations: AutomationService;
  operations: DesktopOperations;
  runAutomation(id: string): Promise<Automation>;
  setMenuContext(context: DesktopMenuContext): void;
  logger: DesktopLogger;
}

export function registerIpc(services: DesktopIpcServices): void {
  const { auth, userContext, agents, workspaces, workspaceFileSuggestions, tasks, extensionFiles, git, terminal, settings, artifacts, browser, automations, operations, runAutomation, setMenuContext, logger } = services;
  const handle = <TArgs extends unknown[], TResult>(channel: string, listener: (event: Electron.IpcMainInvokeEvent, ...args: TArgs) => TResult): void => registerLoggedIpcHandler(logger, channel, listener);
  handle('menu.setContext', async (event, context: unknown) => {
    assertTrustedRenderer(event);
    setMenuContext(z.enum(['login', 'workspace']).parse(context));
  });
  handle('auth.getCurrentUser', async (event) => {
    assertTrustedRenderer(event);
    return auth.getCurrentUser();
  });
  handle('auth.restoreSession', async (event) => {
    assertTrustedRenderer(event);
    return auth.restoreSession();
  });
  handle('auth.login', async (event, input: LoginInput) => {
    assertTrustedRenderer(event);
    return auth.login(input);
  });
  handle('auth.logout', async (event) => {
    assertTrustedRenderer(event);
    return auth.logout();
  });
  handle('userContext.organizations', async event => { assertTrustedRenderer(event); return userContext.organizations(); });
  handle('userContext.organization', async (event, code: unknown) => { assertTrustedRenderer(event); return userContext.organization(idSchema.parse(code)); });
  handle('userContext.wallet', async (event, code: unknown) => { assertTrustedRenderer(event); return userContext.wallet(idSchema.parse(code)); });
  handle('userContext.usage', async (event, organizationCode: unknown, workspaceCode?: unknown) => { assertTrustedRenderer(event); return userContext.usage(idSchema.parse(organizationCode), workspaceCode === undefined ? undefined : idSchema.parse(workspaceCode)); });
  handle('userContext.dashboardStats', async (event, organizationCode: unknown, workspaceCode?: unknown) => { assertTrustedRenderer(event); return userContext.dashboardStats(idSchema.parse(organizationCode), workspaceCode === undefined ? undefined : idSchema.parse(workspaceCode)); });
  handle('userContext.workspaces', async (event, code: unknown) => { assertTrustedRenderer(event); return userContext.workspaces(idSchema.parse(code)); });
  handle('userContext.models', async (event, organizationCode: unknown, workspaceCode: unknown) => { assertTrustedRenderer(event); return userContext.models(idSchema.parse(organizationCode), idSchema.parse(workspaceCode)); });
  handle('runtime.getVersion', async (event) => {
    assertTrustedRenderer(event);
    return process.env['npm_package_version'] ?? '0.1.0';
  });
  handle('agent.initialize', async (event, cwd: unknown) => {
    assertTrustedRenderer(event);
    return agents.initialize(cwdSchema.parse(cwd));
  });
  handle('agent.shutdown', async (event, cwd: unknown) => {
    assertTrustedRenderer(event);
    await agents.shutdown(cwdSchema.parse(cwd));
  });
  handle('agent.sessionCreate', async (event, cwd: unknown, input: unknown) => { assertTrustedRenderer(event); return agents.sessionCreate(cwdSchema.parse(cwd), objectSchema.parse(input) as { model?: string; name?: string }); });
  handle('agent.sessionList', async (event, cwd: unknown) => { assertTrustedRenderer(event); return agents.sessionList(cwdSchema.parse(cwd)); });
  handle('agent.sessionResume', async (event, cwd: unknown, sessionId: unknown) => { assertTrustedRenderer(event); return agents.sessionResume(cwdSchema.parse(cwd), idSchema.parse(sessionId)); });
  handle('agent.turnStart', async (event, cwd: unknown, input: unknown) => {
    assertTrustedRenderer(event);
    const value = objectSchema.parse(input);
    const attachmentIds = value['attachmentIds'] === undefined ? [] : z.array(idSchema).max(16).parse(value['attachmentIds']);
    const taskId = value['taskId'] === undefined ? undefined : idSchema.parse(value['taskId']);
    const attachments = taskId === undefined ? [] : await artifacts.attachmentInputs(taskId, attachmentIds);
    return agents.turnStart(cwdSchema.parse(cwd), { sessionId: idSchema.parse(value['sessionId']), prompt: z.string().min(1).max(512 * 1024).parse(value['prompt']), ...(value['model'] === undefined ? {} : { model: z.string().min(1).max(256).parse(value['model']) }), ...(attachments.length === 0 ? {} : { attachments }) });
  });
  handle('agent.turnCancel', async (event, cwd: unknown, turnId: unknown) => { assertTrustedRenderer(event); return agents.turnCancel(cwdSchema.parse(cwd), idSchema.parse(turnId)); });
  handle('agent.approvalRespond', async (event, cwd: unknown, input: unknown) => { assertTrustedRenderer(event); return agents.approvalRespond(cwdSchema.parse(cwd), objectSchema.parse(input) as { approvalId: string; approved: boolean }); });
  handle('agent.trustRespond', async (event, cwd: unknown, input: unknown) => { assertTrustedRenderer(event); return agents.trustRespond(cwdSchema.parse(cwd), objectSchema.parse(input) as { trustRequestId: string; trusted: boolean }); });
  handle('agent.modelList', async (event, cwd: unknown) => { assertTrustedRenderer(event); return agents.modelList(cwdSchema.parse(cwd)); });
  handle('agent.commandList', async (event, cwd: unknown) => { assertTrustedRenderer(event); return agents.commandList(cwdSchema.parse(cwd)); });
  handle('agent.commandExecute', async (event, cwd: unknown, input: unknown) => { assertTrustedRenderer(event); return agents.commandExecute(cwdSchema.parse(cwd), objectSchema.parse(input)); });
  handle('agent.commandCancel', async (event, cwd: unknown, commandId: unknown) => { assertTrustedRenderer(event); return agents.commandCancel(cwdSchema.parse(cwd), idSchema.parse(commandId)); });
  handle('workspace.list', async event => { assertTrustedRenderer(event); return workspaces.list(); });
  handle('workspace.pickFolder', async event => {
    assertTrustedRenderer(event);
    const selected = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] });
    return selected.canceled ? null : selected.filePaths[0] ?? null;
  });
  handle('workspace.add', async (event, rootPath: unknown) => { assertTrustedRenderer(event); return workspaces.add(cwdSchema.parse(rootPath)); });
  handle('workspace.addRoot', async (event, workspaceId: unknown, rootPath: unknown) => { assertTrustedRenderer(event); return workspaces.addRoot(idSchema.parse(workspaceId), cwdSchema.parse(rootPath)); });
  handle('workspace.rename', async (event, workspaceId: unknown, name: unknown) => { assertTrustedRenderer(event); return workspaces.rename(idSchema.parse(workspaceId), z.string().parse(name)); });
  handle('workspace.reorder', async (event, ids: unknown) => { assertTrustedRenderer(event); return workspaces.reorder(z.array(idSchema).parse(ids)); });
  handle('workspace.settings', async (event, workspaceId: unknown, patch: unknown) => { assertTrustedRenderer(event); return workspaces.updateSettings(idSchema.parse(workspaceId), objectSchema.parse(patch)); });
  handle('workspace.remove', async (event, workspaceId: unknown) => { assertTrustedRenderer(event); return workspaces.remove(idSchema.parse(workspaceId)); });
  handle('workspace.trust', async (event, workspaceId: unknown, trusted: unknown) => { assertTrustedRenderer(event); return workspaces.trust(idSchema.parse(workspaceId), z.boolean().parse(trusted)); });
  handle('workspace.fileSuggestions', async (event, rootPath: unknown, query: unknown) => { assertTrustedRenderer(event); return workspaceFileSuggestions.list(cwdSchema.parse(rootPath), z.string().max(256).parse(query)); });
  handle('task.list', async (event, workspaceId?: unknown) => { assertTrustedRenderer(event); return tasks.list(workspaceId === undefined ? undefined : idSchema.parse(workspaceId)); });
  handle('task.create', async (event, input: unknown) => {
    assertTrustedRenderer(event);
    const value = objectSchema.parse(input);
    const workspaceId = idSchema.parse(value['workspaceId']);
    const workspace = await workspaces.require(workspaceId);
    return tasks.create({ workspaceId, cwd: workspace.rootPath, title: z.string().min(1).parse(value['title']), ...(value['prompt'] === undefined ? {} : { prompt: z.string().parse(value['prompt']) }) });
  });
  handle('task.update', async (event, taskId: unknown, patch: unknown) => { assertTrustedRenderer(event); return tasks.update(idSchema.parse(taskId), objectSchema.parse(patch)); });
  handle('task.status', async (event, taskId: unknown, status: unknown) => { assertTrustedRenderer(event); return tasks.setStatus(idSchema.parse(taskId), z.enum(['queued', 'active', 'completed', 'failed', 'cancelled', 'paused', 'interrupted']).parse(status)); });
  handle('task.retry', async (event, taskId: unknown) => { assertTrustedRenderer(event); return tasks.retry(idSchema.parse(taskId)); });
  handle('task.cancel', async (event, taskId: unknown) => { assertTrustedRenderer(event); return tasks.cancel(idSchema.parse(taskId)); });
  handle('task.resume', async (event, taskId: unknown) => { assertTrustedRenderer(event); return tasks.resume(idSchema.parse(taskId)); });
  handle('task.archive', async (event, taskId: unknown, archived: unknown) => { assertTrustedRenderer(event); return tasks.archive(idSchema.parse(taskId), z.boolean().parse(archived)); });
  handle('task.pin', async (event, taskId: unknown, pinned: unknown) => { assertTrustedRenderer(event); return tasks.pin(idSchema.parse(taskId), z.boolean().parse(pinned)); });
  handle('task.activity', async (event, taskId: unknown, kind: unknown, text: unknown, metadata?: unknown) => { assertTrustedRenderer(event); return tasks.appendActivity(idSchema.parse(taskId), z.enum(['user', 'assistant', 'tool', 'command', 'file', 'approval', 'trust', 'usage', 'context', 'error', 'verification']).parse(kind), z.string().parse(text), metadata === undefined ? {} : objectSchema.parse(metadata)); });
  handle('task.activities', async (event, taskId: unknown) => { assertTrustedRenderer(event); return tasks.activities(idSchema.parse(taskId)); });
  handle('task.artifacts', async (event, taskId: unknown) => { assertTrustedRenderer(event); return artifacts.list(idSchema.parse(taskId)); });
  handle('task.pickArtifact', async (event, taskId: unknown) => { assertTrustedRenderer(event); const selected = await dialog.showOpenDialog({ properties: ['openFile'] }); if (selected.canceled || selected.filePaths[0] === undefined) return null; return artifacts.importFile(idSchema.parse(taskId), selected.filePaths[0], artifactKind(selected.filePaths[0])); });
  handle('task.createTextArtifact', async (event, taskId: unknown, name: unknown, content: unknown, kind?: unknown) => { assertTrustedRenderer(event); return artifacts.createText(idSchema.parse(taskId), z.string().min(1).max(200).parse(name), z.string().max(8 * 1024 * 1024).parse(content), kind === undefined ? 'text' : z.enum(['text', 'markdown', 'patch', 'json']).parse(kind)); });
  handle('task.createImageArtifact', async (event, taskId: unknown, name: unknown, bytes: unknown) => { assertTrustedRenderer(event); if (!(bytes instanceof Uint8Array)) throw new Error('Invalid image bytes.'); return artifacts.createImage(idSchema.parse(taskId), z.string().min(1).max(200).parse(name), bytes); });
  handle('task.deleteArtifact', async (event, taskId: unknown, artifactId: unknown, confirmed: unknown) => { assertTrustedRenderer(event); return artifacts.delete(idSchema.parse(taskId), idSchema.parse(artifactId), z.boolean().parse(confirmed)); });
  handle('task.previewArtifact', async (event, taskId: unknown, artifactId: unknown) => { assertTrustedRenderer(event); return artifacts.preview(idSchema.parse(taskId), idSchema.parse(artifactId)); });
  handle('task.openArtifact', async (event, taskId: unknown, artifactId: unknown) => { assertTrustedRenderer(event); const path = await artifacts.path(idSchema.parse(taskId), idSchema.parse(artifactId)); return shell.openPath(path); });
  handle('extension.readDetail', async (event, input: unknown) => { assertTrustedRenderer(event); return extensionFiles.readDetail(extensionDetailInputSchema.parse(input)); });
  handle('extension.writeDetail', async (event, input: unknown) => { assertTrustedRenderer(event); await extensionFiles.writeDetail(extensionDetailWriteInputSchema.parse(input)); });
  handle('extension.listProjectHooks', async (event, cwd: unknown) => { assertTrustedRenderer(event); return extensionFiles.listProjectHooks(cwdSchema.parse(cwd)); });
  handle('extension.createHook', async (event, input: unknown) => { assertTrustedRenderer(event); return extensionFiles.createHook(hookCreateInputSchema.parse(input)); });
  handle('extension.removeHook', async (event, input: unknown) => { assertTrustedRenderer(event); await extensionFiles.removeHook(hookRemoveInputSchema.parse(input)); });
  handle('git.status', async (event, cwd: unknown) => { assertTrustedRenderer(event); return git.status(cwdSchema.parse(cwd)); });
  handle('git.diff', async (event, cwd: unknown, staged?: unknown) => { assertTrustedRenderer(event); return git.diff(cwdSchema.parse(cwd), staged === undefined ? false : z.boolean().parse(staged)); });
  handle('git.branches', async (event, cwd: unknown) => { assertTrustedRenderer(event); return git.branches(cwdSchema.parse(cwd)); });
  handle('git.stage', async (event, cwd: unknown, path: unknown) => { assertTrustedRenderer(event); return git.stage(cwdSchema.parse(cwd), cwdSchema.parse(path)); });
  handle('git.unstage', async (event, cwd: unknown, path: unknown) => { assertTrustedRenderer(event); return git.unstage(cwdSchema.parse(cwd), cwdSchema.parse(path)); });
  handle('git.commit', async (event, cwd: unknown, message: unknown) => { assertTrustedRenderer(event); return git.commit(cwdSchema.parse(cwd), z.string().parse(message)); });
  handle('git.createBranch', async (event, cwd: unknown, branch: unknown) => { assertTrustedRenderer(event); return git.createBranch(cwdSchema.parse(cwd), z.string().parse(branch)); });
  handle('git.exportPatch', async (event, cwd: unknown, staged?: unknown) => { assertTrustedRenderer(event); return git.exportPatch(cwdSchema.parse(cwd), staged === undefined ? false : z.boolean().parse(staged)); });
  handle('git.worktreeAdd', async (event, cwd: unknown, path: unknown, branch: unknown) => { assertTrustedRenderer(event); return git.worktreeAdd(cwdSchema.parse(cwd), cwdSchema.parse(path), cwdSchema.parse(branch)); });
  handle('git.worktreeRemove', async (event, cwd: unknown, path: unknown, confirmed: unknown) => { assertTrustedRenderer(event); return git.worktreeRemove(cwdSchema.parse(cwd), cwdSchema.parse(path), z.boolean().parse(confirmed)); });
  handle('git.restore', async (event, cwd: unknown, path: unknown, confirmed: unknown) => { assertTrustedRenderer(event); return git.restore(cwdSchema.parse(cwd), cwdSchema.parse(path), z.boolean().parse(confirmed)); });
  handle('terminal.execute', async (event, input: unknown) => {
    assertTrustedRenderer(event);
    const value = terminalExecutionInputSchema.parse(input);
    const result = await terminal.execute(value);
    if (value.taskId) await tasks.appendActivity(value.taskId, 'verification', `${value.command} ${value.args.join(' ')}`.trim(), { cwd: result.cwd, exitCode: result.exitCode, durationMs: result.durationMs, truncated: result.truncated, evidenceId: result.id, output: `${result.stdout}\n${result.stderr}`.slice(0, 4_096) });
    return result;
  });
  handle('terminal.list', async (event, taskId?: unknown) => { assertTrustedRenderer(event); return terminal.list(taskId === undefined ? undefined : idSchema.parse(taskId)); });
  handle('settings.get', async event => { assertTrustedRenderer(event); return settings.get(); });
  handle('settings.update', async (event, patch: unknown) => { assertTrustedRenderer(event); return settings.update(objectSchema.parse(patch)); });
  handle('browser.open', async (event, url: unknown, approved: unknown) => { assertTrustedRenderer(event); return browser.open(z.string().url().parse(url), z.boolean().parse(approved)); });
  handle('browser.close', async (event, id: unknown) => { assertTrustedRenderer(event); return browser.close(idSchema.parse(id)); });
  handle('browser.screenshot', async (event, id: unknown) => { assertTrustedRenderer(event); return browser.screenshot(idSchema.parse(id)); });
  handle('browser.startRecording', async (event, id: unknown) => { assertTrustedRenderer(event); return browser.startRecording(idSchema.parse(id)); });
  handle('browser.stopRecording', async (event, id: unknown) => { assertTrustedRenderer(event); return browser.stopRecording(idSchema.parse(id)); });
  handle('browser.list', async event => { assertTrustedRenderer(event); return browser.list(); });
  handle('browser.evidence', async (event, id: unknown) => { assertTrustedRenderer(event); return browser.evidence(idSchema.parse(id)); });
  handle('automation.list', async event => { assertTrustedRenderer(event); return automations.list(); });
  handle('automation.create', async (event, input: unknown) => { assertTrustedRenderer(event); return automations.create(objectSchema.parse(input) as never); });
  handle('automation.update', async (event, id: unknown, patch: unknown) => { assertTrustedRenderer(event); return automations.update(idSchema.parse(id), objectSchema.parse(patch)); });
  handle('automation.remove', async (event, id: unknown) => { assertTrustedRenderer(event); return automations.remove(idSchema.parse(id)); });
  handle('automation.run', async (event, id: unknown) => { assertTrustedRenderer(event); return runAutomation(idSchema.parse(id)); });
  handle('operations.notify', async (event, title: unknown, body: unknown) => { assertTrustedRenderer(event); operations.notify(z.string().min(1).parse(title), z.string().max(2_000).parse(body)); });
  handle('operations.showWindow', async event => { assertTrustedRenderer(event); operations.showWindow(); });
  handle('operations.exportDiagnostics', async event => { assertTrustedRenderer(event); return operations.exportDiagnostics({ version: process.env['npm_package_version'] ?? '0.1.0', settings: await settings.get() }); });
  handle('operations.checkForUpdates', async event => { assertTrustedRenderer(event); return operations.checkForUpdates(process.env['LOTAGATE_UPDATE_MANIFEST_URL']?.trim() ?? ''); });
}

const idSchema = z.string().min(1).max(256);
const objectSchema = z.record(z.string(), z.unknown());
function artifactKind(path: string): 'markdown' | 'text' | 'image' | 'audio' | 'video' | 'patch' | 'json' | 'binary' { const extension = path.split('.').pop()?.toLowerCase(); if (extension === 'md' || extension === 'markdown') return 'markdown'; if (extension === 'json') return 'json'; if (extension === 'patch' || extension === 'diff') return 'patch'; if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'].includes(extension ?? '')) return 'image'; if (['mp3', 'wav', 'm4a'].includes(extension ?? '')) return 'audio'; if (['mp4', 'webm', 'mov'].includes(extension ?? '')) return 'video'; if (['txt', 'log', 'csv'].includes(extension ?? '')) return 'text'; return 'binary'; }
