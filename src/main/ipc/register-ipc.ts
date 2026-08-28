import { dialog, shell } from 'electron';
import { stat } from 'node:fs/promises';
import { extname, isAbsolute, relative } from 'node:path';
import { realpath } from 'node:fs/promises';
import { z } from 'zod';
import type { DesktopAuthApi, LoginInput } from '../../contracts/ipc/v1/auth.js';
import type { DesktopUserContextService } from '../api/desktop-user-context-service.js';
import type { AgentManager } from '../agents/agent-manager.js';
import type { WorkspaceRegistry } from '../workspaces/workspace-registry.js';
import type { TaskStore, TaskUpdate } from '../tasks/task-store.js';
import type { GitService } from '../git/git-service.js';
import type { TerminalService } from '../terminal/terminal-service.js';
import type { InteractiveTerminalService } from '../terminal/interactive-terminal-service.js';
import type { SettingsService } from '../settings/settings-service.js';
import type { ArtifactService } from '../artifacts/artifact-service.js';
import type { BrowserService } from '../browser/browser-service.js';
import type { AutomationService } from '../automation/automation-service.js';
import type { AutomationRun } from '../../contracts/ipc/v1/automation.js';
import type { DesktopOperations } from '../operations/desktop-operations.js';
import { assertTrustedRenderer } from './sender-policy.js';
import type { DesktopMenuContext } from '../windows/application-menu.js';
import type { WorkspaceFileSuggestions } from '../workspaces/workspace-file-suggestions.js';
import { terminalExecutionInputSchema, terminalSessionOpenSchema, terminalSessionResizeSchema } from '../../contracts/ipc/v1/workspace.js';
import { registerLoggedIpcHandler } from './logged-ipc.js';
import type { DesktopLogger } from '../observability/desktop-logger.js';
import type { ExtensionFileService } from '../extensions/extension-file-service.js';
import { extensionDetailInputSchema, extensionDetailWriteInputSchema, hookCreateInputSchema, hookRemoveInputSchema } from '../../contracts/ipc/v1/extensions-schema.js';
import { automationCreateInputSchema, automationUpdateInputSchema } from '../../contracts/ipc/v1/automation.js';
import { requireDirectory, requireExistingPath } from '../security/path-policy.js';
import { artifactKind } from '../artifacts/artifact-kind.js';

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
  interactiveTerminal: InteractiveTerminalService;
  settings: SettingsService;
  artifacts: ArtifactService;
  browser: BrowserService;
  automations: AutomationService;
  operations: DesktopOperations;
  runAutomation(id: string): Promise<AutomationRun>;
  retryAutomation(runId: string): Promise<AutomationRun>;
  setMenuContext(context: DesktopMenuContext): void;
  logger: DesktopLogger;
}

export function registerIpc(services: DesktopIpcServices): void {
  const { auth, userContext, agents, workspaces, workspaceFileSuggestions, tasks, extensionFiles, git, terminal, interactiveTerminal, settings, artifacts, browser, automations, operations, runAutomation, retryAutomation, setMenuContext, logger } = services;
  const handle = <TArgs extends unknown[], TResult>(channel: string, listener: (event: Electron.IpcMainInvokeEvent, ...args: TArgs) => TResult): void => registerLoggedIpcHandler(logger, channel, listener);
  const requireWorkspaceCwd = (input: unknown): Promise<string> => workspaces.requireRegisteredRoot(cwdSchema.parse(input));
  const taskUpdateSchema = z.object({
    title: z.string().min(1).max(200).optional(),
    pinned: z.boolean().optional(),
    archived: z.boolean().optional(),
    draft: z.string().max(512 * 1024).optional(),
    draftAttachmentIds: z.array(idSchema).max(16).optional(),
    sessionId: idSchema.optional(),
    turnId: idSchema.optional(),
    model: z.string().min(1).max(256).optional(),
    lastEventCursor: z.number().int().nonnegative().optional(),
    interruptedReason: z.string().max(4_096).optional(),
  }).strict();
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
  handle('userContext.paymentHistory', async (event, organizationCode: unknown, page?: unknown, limit?: unknown) => { assertTrustedRenderer(event); return userContext.paymentHistory(idSchema.parse(organizationCode), page === undefined ? 1 : paginationPageSchema.parse(page), limit === undefined ? 10 : paginationLimitSchema.parse(limit)); });
  handle('userContext.workspaces', async (event, code: unknown) => { assertTrustedRenderer(event); return userContext.workspaces(idSchema.parse(code)); });
  handle('userContext.models', async (event, organizationCode: unknown, workspaceCode: unknown) => { assertTrustedRenderer(event); return userContext.models(idSchema.parse(organizationCode), idSchema.parse(workspaceCode)); });
  handle('runtime.getVersion', async (event) => {
    assertTrustedRenderer(event);
    return process.env['npm_package_version'] ?? '0.1.0';
  });
  handle('agent.initialize', async (event, cwd: unknown) => {
    assertTrustedRenderer(event);
    return agents.initialize(await requireWorkspaceCwd(cwd));
  });
  handle('agent.shutdown', async (event, cwd: unknown) => {
    assertTrustedRenderer(event);
    await agents.shutdown(await requireWorkspaceCwd(cwd));
  });
  handle('agent.sessionCreate', async (event, cwd: unknown, input: unknown) => { assertTrustedRenderer(event); return agents.sessionCreate(await requireWorkspaceCwd(cwd), objectSchema.parse(input) as { model?: string; name?: string }); });
  handle('agent.sessionList', async (event, cwd: unknown) => { assertTrustedRenderer(event); return agents.sessionList(await requireWorkspaceCwd(cwd)); });
  handle('agent.sessionResume', async (event, cwd: unknown, sessionId: unknown) => { assertTrustedRenderer(event); return agents.sessionResume(await requireWorkspaceCwd(cwd), idSchema.parse(sessionId)); });
  handle('agent.turnStart', async (event, cwd: unknown, input: unknown) => {
    assertTrustedRenderer(event);
    const canonicalCwd = await requireWorkspaceCwd(cwd);
    const value = objectSchema.parse(input);
    const attachmentIds = value['attachmentIds'] === undefined ? [] : z.array(idSchema).max(16).parse(value['attachmentIds']);
    const taskId = value['taskId'] === undefined ? undefined : idSchema.parse(value['taskId']);
    const sessionId = idSchema.parse(value['sessionId']);
    const task = taskId === undefined ? undefined : await tasks.requireForCwd(taskId, canonicalCwd);
    if (task?.sessionId !== undefined && task.sessionId !== sessionId) throw new Error('The task session does not match the requested agent session.');
    const attachments = taskId === undefined ? [] : await artifacts.attachmentInputs(taskId, attachmentIds);
    return agents.turnStart(canonicalCwd, { sessionId, prompt: z.string().min(1).max(512 * 1024).parse(value['prompt']), ...(value['model'] === undefined ? {} : { model: z.string().min(1).max(256).parse(value['model']) }), ...(attachments.length === 0 ? {} : { attachments }) });
  });
  handle('agent.turnCancel', async (event, cwd: unknown, turnId: unknown) => { assertTrustedRenderer(event); return agents.turnCancel(await requireWorkspaceCwd(cwd), idSchema.parse(turnId)); });
  handle('agent.approvalRespond', async (event, cwd: unknown, input: unknown) => { assertTrustedRenderer(event); return agents.approvalRespond(await requireWorkspaceCwd(cwd), objectSchema.parse(input) as { approvalId: string; approved: boolean }); });
  handle('agent.trustRespond', async (event, cwd: unknown, input: unknown) => { assertTrustedRenderer(event); return agents.trustRespond(await requireWorkspaceCwd(cwd), objectSchema.parse(input) as { trustRequestId: string; trusted: boolean }); });
  handle('agent.modelList', async (event, cwd: unknown) => { assertTrustedRenderer(event); return agents.modelList(await requireWorkspaceCwd(cwd)); });
  handle('agent.commandList', async (event, cwd: unknown) => { assertTrustedRenderer(event); return agents.commandList(await requireWorkspaceCwd(cwd)); });
  handle('agent.commandExecute', async (event, cwd: unknown, input: unknown) => { assertTrustedRenderer(event); return agents.commandExecute(await requireWorkspaceCwd(cwd), objectSchema.parse(input)); });
  handle('agent.commandCancel', async (event, cwd: unknown, commandId: unknown) => { assertTrustedRenderer(event); return agents.commandCancel(await requireWorkspaceCwd(cwd), idSchema.parse(commandId)); });
  handle('workspace.list', async event => { assertTrustedRenderer(event); return workspaces.list(); });
  handle('workspace.pickFolder', async (event, rootPath?: unknown) => {
    assertTrustedRenderer(event);
    const scope = rootPath === undefined ? undefined : await requireDirectory(cwdSchema.parse(rootPath));
    const selected = await dialog.showOpenDialog({ ...(scope === undefined ? {} : { defaultPath: scope }), properties: ['openDirectory', 'createDirectory'] });
    if (selected.canceled || selected.filePaths[0] === undefined) return null;
    return scope === undefined ? selected.filePaths[0] : relative(scope, await requireExistingPath(selected.filePaths[0], scope)) || '.';
  });
  const parseFileExtensions = (extensions: unknown): string[] => extensions === undefined ? [] : z.array(z.string().regex(/^[a-z0-9]+$/iu).max(16)).max(32).parse(extensions).map(extension => extension.toLowerCase());
  const resolvePickedFile = async (filePath: string, scope: string | undefined): Promise<string> => {
    const file = scope === undefined
      ? await realpath(isAbsolute(filePath) ? filePath : (() => { throw new Error('Selected file must use an absolute path.'); })())
      : await requireExistingPath(filePath, scope);
    const details = await stat(file);
    if (!details.isFile()) throw new Error('Selected path must be a file.');
    return file;
  };
  const pickFiles = async (event: Electron.IpcMainInvokeEvent, rootPath: unknown, extensions: unknown, multiSelections: boolean): Promise<string[]> => {
    assertTrustedRenderer(event);
    const scope = rootPath === undefined ? undefined : await requireDirectory(cwdSchema.parse(rootPath));
    const allowedExtensions = parseFileExtensions(extensions);
    const properties: Array<'openFile' | 'multiSelections'> = multiSelections ? ['openFile', 'multiSelections'] : ['openFile'];
    const selected = await dialog.showOpenDialog({ ...(scope === undefined ? {} : { defaultPath: scope }), properties, ...(allowedExtensions.length === 0 ? {} : { filters: [{ name: 'Supported files', extensions: allowedExtensions }] }) });
    if (selected.canceled) return [];
    const files = await Promise.all(selected.filePaths.map(filePath => resolvePickedFile(filePath, scope)));
    for (const file of files) {
      const extension = extname(file).slice(1).toLowerCase();
      if (allowedExtensions.length > 0 && !allowedExtensions.includes(extension)) throw new Error(`Select a file with one of these extensions: ${allowedExtensions.join(', ')}.`);
    }
    return scope === undefined ? files : files.map(file => relative(scope, file));
  };
  handle('workspace.pickFile', async (event, rootPath?: unknown, extensions?: unknown) => { const files = await pickFiles(event, rootPath, extensions, false); return files[0] ?? null; });
  handle('workspace.pickMultipleFile', async (event, rootPath?: unknown, extensions?: unknown) => pickFiles(event, rootPath, extensions, true));
  handle('workspace.fileSize', async (event, rootPath: unknown, filePath: unknown) => {
    assertTrustedRenderer(event);
    const scope = rootPath === undefined ? undefined : await requireDirectory(cwdSchema.parse(rootPath));
    const file = await resolvePickedFile(z.string().min(1).max(4_096).parse(filePath), scope);
    return (await stat(file)).size;
  });
  handle('workspace.add', async (event, rootPath: unknown) => { assertTrustedRenderer(event); return workspaces.add(cwdSchema.parse(rootPath)); });
  handle('workspace.addRoot', async (event, workspaceId: unknown, rootPath: unknown) => { assertTrustedRenderer(event); return workspaces.addRoot(idSchema.parse(workspaceId), cwdSchema.parse(rootPath)); });
  handle('workspace.rename', async (event, workspaceId: unknown, name: unknown) => { assertTrustedRenderer(event); return workspaces.rename(idSchema.parse(workspaceId), z.string().parse(name)); });
  handle('workspace.reorder', async (event, ids: unknown) => { assertTrustedRenderer(event); return workspaces.reorder(z.array(idSchema).parse(ids)); });
  handle('workspace.settings', async (event, workspaceId: unknown, patch: unknown) => { assertTrustedRenderer(event); return workspaces.updateSettings(idSchema.parse(workspaceId), objectSchema.parse(patch)); });
  handle('workspace.remove', async (event, workspaceId: unknown) => { assertTrustedRenderer(event); return workspaces.remove(idSchema.parse(workspaceId)); });
  handle('workspace.trust', async (event, workspaceId: unknown, trusted: unknown) => { assertTrustedRenderer(event); return workspaces.trust(idSchema.parse(workspaceId), z.boolean().parse(trusted)); });
  handle('workspace.fileSuggestions', async (event, rootPath: unknown, query: unknown) => { assertTrustedRenderer(event); return workspaceFileSuggestions.list(await requireWorkspaceCwd(rootPath), z.string().max(256).parse(query)); });
  handle('task.list', async (event, workspaceId?: unknown) => { assertTrustedRenderer(event); return tasks.list(workspaceId === undefined ? undefined : idSchema.parse(workspaceId)); });
  handle('task.create', async (event, input: unknown) => {
    assertTrustedRenderer(event);
    const value = objectSchema.parse(input);
    const workspaceId = idSchema.parse(value['workspaceId']);
    const workspace = await workspaces.require(workspaceId);
    return tasks.create({ workspaceId, cwd: workspace.rootPath, title: z.string().min(1).parse(value['title']), ...(value['prompt'] === undefined ? {} : { prompt: z.string().parse(value['prompt']) }) });
  });
  handle('task.update', async (event, taskId: unknown, patch: unknown) => { assertTrustedRenderer(event); return tasks.update(idSchema.parse(taskId), taskUpdateSchema.parse(patch) as TaskUpdate); });
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
  handle('task.readArtifactMedia', async (event, taskId: unknown, artifactId: unknown) => { assertTrustedRenderer(event); return artifacts.readMedia(idSchema.parse(taskId), idSchema.parse(artifactId)); });
  handle('task.downloadArtifact', async (event, taskId: unknown, artifactId: unknown) => {
    assertTrustedRenderer(event);
    const artifact = await artifacts.list(idSchema.parse(taskId));
    const selected = artifact.find(item => item.id === idSchema.parse(artifactId));
    if (selected === undefined) throw new Error('Artifact was not found.');
    const destination = await dialog.showSaveDialog({ defaultPath: selected.name });
    if (destination.canceled || destination.filePath === undefined) return null;
    await artifacts.download(selected.taskId, selected.id, destination.filePath);
    return destination.filePath;
  });
  handle('task.openArtifact', async (event, taskId: unknown, artifactId: unknown) => { assertTrustedRenderer(event); const path = await artifacts.path(idSchema.parse(taskId), idSchema.parse(artifactId)); return shell.openPath(path); });
  handle('extension.readDetail', async (event, input: unknown) => { assertTrustedRenderer(event); return extensionFiles.readDetail(extensionDetailInputSchema.parse(input)); });
  handle('extension.writeDetail', async (event, input: unknown) => { assertTrustedRenderer(event); await extensionFiles.writeDetail(extensionDetailWriteInputSchema.parse(input)); });
  handle('extension.listProjectHooks', async (event, cwd: unknown) => { assertTrustedRenderer(event); return extensionFiles.listProjectHooks(await requireWorkspaceCwd(cwd)); });
  handle('extension.createHook', async (event, input: unknown) => { assertTrustedRenderer(event); return extensionFiles.createHook(hookCreateInputSchema.parse(input)); });
  handle('extension.removeHook', async (event, input: unknown) => { assertTrustedRenderer(event); await extensionFiles.removeHook(hookRemoveInputSchema.parse(input)); });
  handle('git.status', async (event, cwd: unknown) => { assertTrustedRenderer(event); return git.status(await requireWorkspaceCwd(cwd)); });
  handle('git.diff', async (event, cwd: unknown, staged?: unknown) => { assertTrustedRenderer(event); return git.diff(await requireWorkspaceCwd(cwd), staged === undefined ? false : z.boolean().parse(staged)); });
  handle('git.fileDiff', async (event, cwd: unknown, path: unknown, staged?: unknown) => { assertTrustedRenderer(event); return git.fileDiff(await requireWorkspaceCwd(cwd), cwdSchema.parse(path), staged === undefined ? false : z.boolean().parse(staged)); });
  handle('git.readFile', async (event, cwd: unknown, path: unknown) => { assertTrustedRenderer(event); return git.readFile(await requireWorkspaceCwd(cwd), cwdSchema.parse(path)); });
  handle('git.branches', async (event, cwd: unknown) => { assertTrustedRenderer(event); return git.branches(await requireWorkspaceCwd(cwd)); });
  handle('git.branchList', async (event, cwd: unknown) => { assertTrustedRenderer(event); return git.branchList(await requireWorkspaceCwd(cwd)); });
  handle('git.stage', async (event, cwd: unknown, path: unknown) => { assertTrustedRenderer(event); return git.stage(await requireWorkspaceCwd(cwd), cwdSchema.parse(path)); });
  handle('git.stageAll', async (event, cwd: unknown) => { assertTrustedRenderer(event); return git.stageAll(await requireWorkspaceCwd(cwd)); });
  handle('git.unstage', async (event, cwd: unknown, path: unknown) => { assertTrustedRenderer(event); return git.unstage(await requireWorkspaceCwd(cwd), cwdSchema.parse(path)); });
  handle('git.unstageAll', async (event, cwd: unknown) => { assertTrustedRenderer(event); return git.unstageAll(await requireWorkspaceCwd(cwd)); });
  handle('git.commit', async (event, cwd: unknown, message: unknown) => { assertTrustedRenderer(event); return git.commit(await requireWorkspaceCwd(cwd), z.string().parse(message)); });
  handle('git.createBranch', async (event, cwd: unknown, branch: unknown) => { assertTrustedRenderer(event); return git.createBranch(await requireWorkspaceCwd(cwd), z.string().parse(branch)); });
  handle('git.checkout', async (event, cwd: unknown, branch: unknown, confirmed: unknown) => { assertTrustedRenderer(event); return git.checkout(await requireWorkspaceCwd(cwd), z.string().parse(branch), z.boolean().parse(confirmed)); });
  handle('git.fetch', async (event, cwd: unknown) => { assertTrustedRenderer(event); return git.fetch(await requireWorkspaceCwd(cwd)); });
  handle('git.pull', async (event, cwd: unknown) => { assertTrustedRenderer(event); return git.pull(await requireWorkspaceCwd(cwd)); });
  handle('git.push', async (event, cwd: unknown, confirmed: unknown) => { assertTrustedRenderer(event); return git.push(await requireWorkspaceCwd(cwd), z.boolean().parse(confirmed)); });
  handle('git.history', async (event, cwd: unknown, limit?: unknown) => { assertTrustedRenderer(event); return git.history(await requireWorkspaceCwd(cwd), limit === undefined ? undefined : z.number().int().min(1).max(200).parse(limit)); });
  handle('git.stashList', async (event, cwd: unknown) => { assertTrustedRenderer(event); return git.stashList(await requireWorkspaceCwd(cwd)); });
  handle('git.stashSave', async (event, cwd: unknown, message?: unknown) => { assertTrustedRenderer(event); return git.stashSave(await requireWorkspaceCwd(cwd), message === undefined ? undefined : z.string().max(500).parse(message)); });
  handle('git.stashApply', async (event, cwd: unknown, reference: unknown) => { assertTrustedRenderer(event); return git.stashApply(await requireWorkspaceCwd(cwd), z.string().parse(reference)); });
  handle('git.stashDrop', async (event, cwd: unknown, reference: unknown, confirmed: unknown) => { assertTrustedRenderer(event); return git.stashDrop(await requireWorkspaceCwd(cwd), z.string().parse(reference), z.boolean().parse(confirmed)); });
  handle('git.exportPatch', async (event, cwd: unknown, staged?: unknown) => { assertTrustedRenderer(event); return git.exportPatch(await requireWorkspaceCwd(cwd), staged === undefined ? false : z.boolean().parse(staged)); });
  handle('git.worktreeAdd', async (event, cwd: unknown, path: unknown, branch: unknown) => { assertTrustedRenderer(event); return git.worktreeAdd(await requireWorkspaceCwd(cwd), cwdSchema.parse(path), z.string().parse(branch)); });
  handle('git.worktreeRemove', async (event, cwd: unknown, path: unknown, confirmed: unknown) => { assertTrustedRenderer(event); return git.worktreeRemove(await requireWorkspaceCwd(cwd), cwdSchema.parse(path), z.boolean().parse(confirmed)); });
  handle('git.restore', async (event, cwd: unknown, path: unknown, confirmed: unknown) => { assertTrustedRenderer(event); return git.restore(await requireWorkspaceCwd(cwd), cwdSchema.parse(path), z.boolean().parse(confirmed)); });
  handle('terminal.execute', async (event, input: unknown) => {
    assertTrustedRenderer(event);
    const value = terminalExecutionInputSchema.parse(input);
    const result = await terminal.execute({ ...value, cwd: await requireWorkspaceCwd(value.cwd) });
    if (value.taskId) await tasks.appendActivity(value.taskId, 'verification', `${value.command} ${value.args.join(' ')}`.trim(), { cwd: result.cwd, exitCode: result.exitCode, durationMs: result.durationMs, truncated: result.truncated, evidenceId: result.id, output: `${result.stdout}\n${result.stderr}`.slice(0, 4_096) });
    return result;
  });
  handle('terminal.list', async (event, taskId?: unknown) => { assertTrustedRenderer(event); return terminal.list(taskId === undefined ? undefined : idSchema.parse(taskId)); });
  handle('terminal.open', async (event, input: unknown) => { assertTrustedRenderer(event); const value = terminalSessionOpenSchema.parse(input); const session = await interactiveTerminal.open({ ...value, cwd: await requireWorkspaceCwd(value.cwd) }, event.sender.id, output => event.sender.send('terminal.output', output)); event.sender.once('destroyed', () => interactiveTerminal.closeOwner(event.sender.id)); return session; });
   handle('terminal.write', async (event, sessionId: unknown, data: unknown) => { assertTrustedRenderer(event); interactiveTerminal.write(idSchema.parse(sessionId), z.string().min(1).max(128 * 1024).parse(data), event.sender.id); });
   handle('terminal.resize', async (event, input: unknown) => { assertTrustedRenderer(event); const value = terminalSessionResizeSchema.parse(input); interactiveTerminal.resize(value.sessionId, value.cols, value.rows, event.sender.id); });
   handle('terminal.close', async (event, sessionId: unknown) => { assertTrustedRenderer(event); interactiveTerminal.close(idSchema.parse(sessionId), event.sender.id); });
  handle('settings.get', async event => { assertTrustedRenderer(event); return settings.get(); });
  handle('settings.update', async (event, patch: unknown) => { assertTrustedRenderer(event); return settings.update(objectSchema.parse(patch)); });
  handle('browser.create', async event => { assertTrustedRenderer(event); return browser.create(); });
  handle('browser.open', async (event, url: unknown, approved: unknown) => { assertTrustedRenderer(event); return browser.open(z.string().url().parse(url), z.boolean().parse(approved)); });
  handle('browser.close', async (event, id: unknown) => { assertTrustedRenderer(event); return browser.close(idSchema.parse(id)); });
  handle('browser.createTab', async (event, sessionId: unknown) => { assertTrustedRenderer(event); return browser.createTab(idSchema.parse(sessionId)); });
  handle('browser.closeTab', async (event, sessionId: unknown, tabId: unknown) => { assertTrustedRenderer(event); return browser.closeTab(idSchema.parse(sessionId), idSchema.parse(tabId)); });
  handle('browser.selectTab', async (event, sessionId: unknown, tabId: unknown) => { assertTrustedRenderer(event); return browser.selectTab(idSchema.parse(sessionId), idSchema.parse(tabId)); });
  handle('browser.navigate', async (event, sessionId: unknown, tabId: unknown, url: unknown, approved: unknown) => { assertTrustedRenderer(event); return browser.navigate(idSchema.parse(sessionId), idSchema.parse(tabId), z.string().url().parse(url), z.boolean().parse(approved)); });
  handle('browser.goBack', async (event, sessionId: unknown, tabId: unknown) => { assertTrustedRenderer(event); return browser.goBack(idSchema.parse(sessionId), idSchema.parse(tabId)); });
  handle('browser.goForward', async (event, sessionId: unknown, tabId: unknown) => { assertTrustedRenderer(event); return browser.goForward(idSchema.parse(sessionId), idSchema.parse(tabId)); });
  handle('browser.reload', async (event, sessionId: unknown, tabId: unknown) => { assertTrustedRenderer(event); return browser.reload(idSchema.parse(sessionId), idSchema.parse(tabId)); });
  handle('browser.setViewBounds', async (event, sessionId: unknown, tabId: unknown, bounds: unknown, visible: unknown) => { assertTrustedRenderer(event); const value = browserBoundsSchema.parse(bounds); browser.setViewBounds(idSchema.parse(sessionId), idSchema.parse(tabId), value, z.boolean().parse(visible)); });
  handle('browser.screenshot', async (event, sessionId: unknown, tabId?: unknown) => { assertTrustedRenderer(event); return browser.screenshot(idSchema.parse(sessionId), tabId === undefined ? undefined : idSchema.parse(tabId)); });
  handle('browser.startRecording', async (event, id: unknown) => { assertTrustedRenderer(event); return browser.startRecording(idSchema.parse(id)); });
  handle('browser.stopRecording', async (event, id: unknown) => { assertTrustedRenderer(event); return browser.stopRecording(idSchema.parse(id)); });
  handle('browser.list', async event => { assertTrustedRenderer(event); return browser.list(); });
  handle('browser.evidence', async (event, id: unknown) => { assertTrustedRenderer(event); return browser.evidence(idSchema.parse(id)); });
  handle('automation.list', async event => { assertTrustedRenderer(event); return automations.list(); });
  handle('automation.get', async (event, id: unknown) => { assertTrustedRenderer(event); return automations.get(idSchema.parse(id)); });
  handle('automation.create', async (event, input: unknown) => { assertTrustedRenderer(event); return automations.create(automationCreateInputSchema.parse(input)); });
  handle('automation.update', async (event, id: unknown, patch: unknown) => { assertTrustedRenderer(event); return automations.update(idSchema.parse(id), automationUpdateInputSchema.parse(patch)); });
  handle('automation.remove', async (event, id: unknown) => { assertTrustedRenderer(event); return automations.remove(idSchema.parse(id)); });
  handle('automation.run', async (event, id: unknown) => { assertTrustedRenderer(event); return runAutomation(idSchema.parse(id)); });
  handle('automation.pause', async (event, id: unknown) => { assertTrustedRenderer(event); return automations.pause(idSchema.parse(id)); });
  handle('automation.resume', async (event, id: unknown) => { assertTrustedRenderer(event); return automations.resume(idSchema.parse(id)); });
  handle('automation.cancel', async (event, runId: unknown) => { assertTrustedRenderer(event); return automations.cancel(idSchema.parse(runId)); });
  handle('automation.retry', async (event, runId: unknown) => { assertTrustedRenderer(event); return retryAutomation(idSchema.parse(runId)); });
  handle('automation.review', async (event, runId: unknown, approved: unknown) => { assertTrustedRenderer(event); return automations.review(idSchema.parse(runId), z.boolean().parse(approved)); });
  handle('automation.approvalRespond', async (event, runId: unknown, approvalId: unknown, approved: unknown) => { assertTrustedRenderer(event); return automations.respondApproval(idSchema.parse(runId), idSchema.parse(approvalId), z.boolean().parse(approved)); });
  handle('automation.runs', async (event, id: unknown, limit?: unknown) => { assertTrustedRenderer(event); return automations.runs(idSchema.parse(id), limit === undefined ? 100 : z.number().int().min(1).max(100).parse(limit)); });
  handle('operations.notify', async (event, title: unknown, body: unknown) => { assertTrustedRenderer(event); operations.notify(z.string().min(1).parse(title), z.string().max(2_000).parse(body)); });
  handle('operations.showWindow', async event => { assertTrustedRenderer(event); operations.showWindow(); });
  handle('operations.exportDiagnostics', async event => { assertTrustedRenderer(event); return operations.exportDiagnostics({ version: process.env['npm_package_version'] ?? '0.1.0', settings: await settings.get() }); });
  handle('operations.checkForUpdates', async event => { assertTrustedRenderer(event); return operations.checkForUpdates(process.env['LOTAGATE_UPDATE_MANIFEST_URL']?.trim() ?? ''); });
}

const idSchema = z.string().min(1).max(256);
const browserBoundsSchema = z.object({ x: z.number().finite().min(0).max(10_000), y: z.number().finite().min(0).max(10_000), width: z.number().finite().min(0).max(10_000), height: z.number().finite().min(0).max(10_000) }).strict();
const paginationPageSchema = z.number().int().min(1);
const paginationLimitSchema = z.number().int().min(1).max(100);
const objectSchema = z.record(z.string(), z.unknown());
