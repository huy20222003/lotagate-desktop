import { app, BrowserWindow } from 'electron';
import { AgentManager } from './agents/agent-manager.js';
import { ApiTransport } from './api/api-transport.js';
import { DesktopAuthService } from './api/desktop-auth-service.js';
import { DesktopUserContextService } from './api/desktop-user-context-service.js';
import { loadRuntimeEnvironment, readRuntimeConfig } from './config/runtime-config.js';
import { registerIpc } from './ipc/register-ipc.js';
import { createMainWindow } from './windows/create-main-window.js';
import { configureMediaPermissions } from './windows/media-permissions.js';
import { setApplicationMenu } from './windows/application-menu.js';
import { WorkspaceRegistry } from './workspaces/workspace-registry.js';
import { TaskStore } from './tasks/task-store.js';
import { TaskEventProjector } from './tasks/task-event-projector.js';
import { GitService } from './git/git-service.js';
import { TerminalService } from './terminal/terminal-service.js';
import { SettingsService } from './settings/settings-service.js';
import { ArtifactService } from './artifacts/artifact-service.js';
import { BrowserService } from './browser/browser-service.js';
import { AutomationService } from './automation/automation-service.js';
import { DesktopOperations } from './operations/desktop-operations.js';
import { WorkspaceFileSuggestions } from './workspaces/workspace-file-suggestions.js';
import type { Automation } from './automation/automation-service.js';
import { DesktopLogger } from './observability/desktop-logger.js';
import { PersistentCache } from './cache/persistent-cache.js';
import { ExtensionFileService } from './extensions/extension-file-service.js';

loadRuntimeEnvironment();
const runtimeConfig = readRuntimeConfig();
let agentManager: AgentManager | undefined;
let browserService: BrowserService | undefined;
let automationService: AutomationService | undefined;
let shuttingDown = false;
const logger = new DesktopLogger();
const cache = new PersistentCache();

if (!app.requestSingleInstanceLock()) app.quit();
else app.on('second-instance', (_event, commandLine) => {
  const deepLink = commandLine.find(argument => argument.startsWith('lotagate://'));
  if (deepLink) for (const window of BrowserWindow.getAllWindows()) window.webContents.send('operations.deepLink', deepLink);
  const window = BrowserWindow.getAllWindows()[0];
  if (window !== undefined) { if (window.isMinimized()) window.restore(); window.focus(); }
});

app.whenReady().then(() => {
  logger.info('app.ready', { platform: process.platform, arch: process.arch });
  configureMediaPermissions();
  setApplicationMenu('login');
  const transport = new ApiTransport({
    baseUrl: runtimeConfig.apiBaseUrl,
    trustedOrigin: runtimeConfig.trustedOrigin,
    partition: runtimeConfig.authPartition,
    logger,
    cache,
    onSessionExpired: async () => { await agentManager?.shutdownAll(); for (const window of BrowserWindow.getAllWindows()) window.webContents.send('auth.sessionExpired'); },
  });
  const workspaces = new WorkspaceRegistry();
  const extensionFiles = new ExtensionFileService(workspaces);
  const tasks = new TaskStore();
  const taskProjector = new TaskEventProjector(tasks);
  const browser = new BrowserService();
  browserService = browser;
  const operations = new DesktopOperations();
  operations.initializeDeepLinks();
  operations.initializeTray();
  const agents = new AgentManager({
    onEvent: (cwd, event) => {
      logger.debug('agent.event', { cwd, event: event.event });
      void taskProjector.apply(cwd, event).catch(() => undefined);
      for (const window of BrowserWindow.getAllWindows()) window.webContents.send('agent.event', { cwd, event });
    },
    onDiagnostic: (cwd, diagnostic) => { logger.warn('agent.diagnostic', { cwd, kind: diagnostic.kind, message: diagnostic.message }); for (const window of BrowserWindow.getAllWindows()) window.webContents.send('agent.diagnostic', { cwd, diagnostic }); },
    onExit: (cwd, error) => {
      void tasks.interruptActiveByCwd(cwd, error.message).catch(() => undefined);
      logger.error('agent.process.exit', { cwd, error: error.message });
      for (const window of BrowserWindow.getAllWindows()) window.webContents.send('agent.diagnostic', { cwd, diagnostic: { kind: 'protocol', message: error.message } });
    },
  }, cache);
  agentManager = agents;
  const automations = new AutomationService();
  automationService = automations;
  const executeAutomation = async (automation: Automation): Promise<void> => {
    const workspace = await workspaces.require(automation.workspaceId);
    const task = await tasks.create({ workspaceId: workspace.id, cwd: workspace.rootPath, title: automation.name, prompt: automation.prompt });
    await agents.initialize(workspace.rootPath);
    const session = await agents.sessionCreate(workspace.rootPath, { name: task.title });
    const sessionId = extractSessionId(session);
    if (sessionId === undefined) throw new Error('Automation could not create a CLI session.');
    await tasks.update(task.id, { sessionId });
    await agents.turnStart(workspace.rootPath, { sessionId, prompt: automation.prompt });
  };
  const runAutomation = (id: string): Promise<Automation> => automations.run(id, executeAutomation);
  registerIpc({ auth: new DesktopAuthService(transport, () => agents.shutdownAll()), userContext: new DesktopUserContextService(transport, cache), agents, workspaces, workspaceFileSuggestions: new WorkspaceFileSuggestions(), tasks, extensionFiles, git: new GitService(), terminal: new TerminalService(workspaces, tasks), settings: new SettingsService(), artifacts: new ArtifactService(), browser, automations, operations, runAutomation, setMenuContext: setApplicationMenu, logger });
  automations.start(executeAutomation, 15_000);
  createMainWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', (event) => {
  if (shuttingDown) return;
  event.preventDefault();
  shuttingDown = true;
  automationService?.stop();
  void Promise.all([agentManager?.shutdownAll(), browserService?.closeAll()]).finally(async () => { await logger.close(); app.quit(); });
});

function extractSessionId(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const session = (value as Record<string, unknown>)['session'];
  if (typeof session !== 'object' || session === null) return undefined;
  const id = (session as Record<string, unknown>)['id'];
  return typeof id === 'string' ? id : undefined;
}
