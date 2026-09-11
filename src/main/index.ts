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
import { TaskTurnCoordinator } from './tasks/task-turn-coordinator.js';
import { TaskEventProjector } from './tasks/task-event-projector.js';
import { TaskTitleGenerationService } from './tasks/task-title-generation-service.js';
import { GitService } from './git/git-service.js';
import { TerminalService } from './terminal/terminal-service.js';
import { InteractiveTerminalService } from './terminal/interactive-terminal-service.js';
import { SettingsService } from './settings/settings-service.js';
import { ArtifactService } from './artifacts/artifact-service.js';
import { BrowserService } from './browser/browser-service.js';
import { BrowserHostToolBroker } from './agents/browser-host-tool-broker.js';
import { DesktopHostExecutionBroker } from './agents/desktop-host-execution-broker.js';
import { ContainerSandboxExecutionProvider } from './agents/sandbox-execution-provider.js';
import { buildInteractiveDesktopExecutionPolicy } from './agents/desktop-execution-policy.js';
import { AutomationService } from './automation/automation-service.js';
import { DesktopOperations } from './operations/desktop-operations.js';
import { WorkspaceFileSuggestions } from './workspaces/workspace-file-suggestions.js';
import type { AutomationRun } from '../contracts/ipc/v1/automation.js';
import type { AutomationApproval } from '../contracts/ipc/v1/automation.js';
import { DesktopLogger } from './observability/desktop-logger.js';
import { PersistentCache } from './cache/persistent-cache.js';
import { ExtensionFileService } from './extensions/extension-file-service.js';
import { cleanupAutomationWorkspace } from './automation/automation-workspace.js';
import { formatToolDisplayName } from '../shared/tool-display.js';
import { AutomationOsScheduler } from './automation/automation-os-scheduler.js';
import { ApprovalCoordinator } from './approvals/approval-coordinator.js';
import { CheckpointService } from './checkpoints/checkpoint-service.js';
import type { DesktopApprovalInput } from '../contracts/ipc/v1/approval.js';
import { automationNotification } from './automation/automation-notification.js';
import { configureWindowsAppIdentity, configureWindowsDevelopmentShortcut } from './windows/windows-app-identity.js';
import { desktopAssetPath, desktopResourcePath } from './app-assets.js';
import { AutomationExecutionService } from './automation/automation-execution-service.js';
import { RemoteControlService } from './remote-control/remote-control-service.js';
import { DesktopUpdateService } from './updates/desktop-update-service.js';
import { ComputerHostToolBroker } from './computer/computer-host-tool-broker.js';
import { DocumentHostToolBroker } from './documents/document-host-tool-broker.js';
import { ComputerOverlay } from './computer/computer-overlay.js';
import { createNativeHostProviders } from './host/native-host-provider-factory.js';
import { PublicPluginBootstrapService } from './extensions/public-plugin-bootstrap-service.js';
import { WhisperCppSpeechTranscriptionService } from './speech/whisper-cpp-speech-transcription-service.js';
import { AgentEventCoordinator } from './agents/agent-event-coordinator.js';
import { NativeDependencyService } from './dependencies/native-dependency-service.js';

loadRuntimeEnvironment();
const runtimeConfig = readRuntimeConfig();
const automationDispatchRequested = process.argv.includes('--automation-dispatch');
const nativeDependencyRestarted = process.argv.includes('--native-dependencies-restarted');
let agentManager: AgentManager | undefined;
let browserService: BrowserService | undefined;
let computerBroker: ComputerHostToolBroker | undefined;
let documentBroker: DocumentHostToolBroker | undefined;
let automationService: AutomationService | undefined;
let approvalCoordinator: ApprovalCoordinator | undefined;
let taskProjector: TaskEventProjector | undefined;
let titleGenerationService: TaskTitleGenerationService | undefined;
let automationDispatchHandler: (() => Promise<void>) | undefined;
let remoteControlService: RemoteControlService | undefined;
let pendingAutomationDispatch = false;
let shuttingDown = false;
const logger = new DesktopLogger();
const cache = new PersistentCache();

configureWindowsAppIdentity();

if (!app.requestSingleInstanceLock()) app.quit();
else app.on('second-instance', (_event, commandLine) => {
  if (commandLine.includes('--automation-dispatch')) {
    if (automationDispatchHandler === undefined) pendingAutomationDispatch = true;
    else void automationDispatchHandler().catch(error => logger.error('automation.dispatch.failed', { message: error instanceof Error ? error.message : 'Unable to dispatch automation runs.' }));
    return;
  }
  const deepLink = commandLine.find(argument => argument.startsWith('lotagate://'));
  if (deepLink) broadcastToActiveWindows('operations.deepLink', deepLink);
  const window = BrowserWindow.getAllWindows()[0];
  if (window !== undefined) { if (window.isMinimized()) window.restore(); window.focus(); }
});

function broadcastToActiveWindows(channel: string, ...args: unknown[]): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed() && !window.webContents.isDestroyed() && window.isFocusable()) {
      window.webContents.send(channel, ...args);
    }
  }
}

app.whenReady().then(async () => {
  logger.info('app.ready', { platform: process.platform, arch: process.arch });
  await configureWindowsDevelopmentShortcut(desktopAssetPath('lotagate.ico')).catch(error => logger.warn('windows.dev.notification.shortcut.failed', { message: error instanceof Error ? error.message : 'Unable to register the development notification shortcut.' }));
  if (!automationDispatchRequested) { configureMediaPermissions(); setApplicationMenu('login'); }
  let userContext!: DesktopUserContextService;
  const transport = new ApiTransport({
    baseUrl: runtimeConfig.apiBaseUrl,
    trustedOrigin: runtimeConfig.trustedOrigin,
    partition: runtimeConfig.authPartition,
    logger,
    cache,
    onSessionExpired: async () => { userContext.resetSession(); await remoteControlService?.stop(); await approvalCoordinator?.cancelAll(); await agentManager?.shutdownAll('auth.session-expired'); broadcastToActiveWindows('auth.sessionExpired'); },
  });
  userContext = new DesktopUserContextService(transport, cache);
  const workspaces = new WorkspaceRegistry();
  const tasks = new TaskStore();
  const taskTurns = new TaskTurnCoordinator();
  const interruptedTasks = await tasks.interruptActive('Desktop restarted before the previous turn completed.');
  if (interruptedTasks.length > 0) logger.warn('tasks.reconciled.interrupted', { count: interruptedTasks.length, reason: 'app-restart' });
  const checkpoints = new CheckpointService({ onError: (error, cwd) => logger.warn('checkpoint.capture.failed', { cwd, message: error instanceof Error ? error.message : 'Unable to capture workspace checkpoint.' }) });
  const artifacts = new ArtifactService();
  const settings = new SettingsService();
  const approvals = new ApprovalCoordinator();
  approvalCoordinator = approvals;
  approvals.onRequest(request => { remoteControlService?.publishApprovalRequest(request); broadcastToActiveWindows('approval.requested', request); });
  approvals.onResolved(resolution => { remoteControlService?.publishApprovalResolution(resolution); broadcastToActiveWindows('approval.resolved', resolution); });
  taskProjector = new TaskEventProjector(tasks, (error, cwd) => logger.error('task.event.persist.failed', { cwd, message: error instanceof Error ? error.message : 'Unable to persist agent event.' }));
  const browser = new BrowserService(snapshot => {
    broadcastToActiveWindows('browser.state', snapshot);
  }, async () => (await settings.get()).browser);
  browserService = browser;
  const browserHost = new BrowserHostToolBroker(browser, (cwd, activity) => {
    logger.debug('agent.browser', { cwd, event: activity.event, action: activity.data['action'] });
    const event = { version: 1 as const, type: 'event' as const, scope: 'session' as const, event: activity.event, data: activity.data };
    broadcastToActiveWindows('agent.event', { cwd, event });
  });
  const hostExecution = new DesktopHostExecutionBroker({
    sandbox: new ContainerSandboxExecutionProvider(async () => {
      const configured = (await settings.get()).sandbox;
      return { backend: configured.backend, image: configured.image, network: configured.networkPolicy, mountMode: configured.mountMode, memoryMb: configured.memoryMb, cpuCores: configured.cpuCores, pidsLimit: configured.pidsLimit, cleanup: configured.cleanup };
    }),
    onFileChanged: (cwd, change) => logger.debug('agent.host.file.changed', { cwd, path: change.path, kind: change.kind }),
  });
  const operations = new DesktopOperations(undefined, async () => ({ defaultFileOpenDestination: (await settings.get()).defaultFileOpenDestination }));
  const speech = new WhisperCppSpeechTranscriptionService();
  const updates = new DesktopUpdateService(transport, logger, runtimeConfig.updateSigningPublicKey);
  if (!automationDispatchRequested) { operations.initializeDeepLinks(); operations.initializeTray(); }
  const automations = new AutomationService();
  automationService = automations;
  const automationSessions = new Map<string, { runId: string; cwd: string }>();
  const nativeDependencies = new NativeDependencyService({
    manifestPath: desktopResourcePath('native-dependencies', 'manifest.json'),
    log: (message, fields) => logger.warn(message, fields),
  });
  const dependencyReport = await nativeDependencies.ensureInstalled(!nativeDependencyRestarted && (app.isPackaged || process.env['LOTAGATE_AUTO_INSTALL_NATIVE_DEPENDENCIES'] === '1'));
  if (dependencyReport.manual.length > 0 || dependencyReport.missing.length > 0 || dependencyReport.failed.length > 0) {
    logger.warn('native-dependency.bootstrap.incomplete', {
      platform: dependencyReport.platform,
      missing: dependencyReport.missing,
      manual: dependencyReport.manual,
      failed: dependencyReport.failed,
    });
  }
  if (dependencyReport.restartRequired) {
    logger.info('native-dependency.bootstrap.restart', { platform: dependencyReport.platform });
    app.relaunch({ args: [...process.argv.slice(1), '--native-dependencies-restarted'] });
    app.exit(0);
    return;
  }
  const nativeHostProviders = await createNativeHostProviders({
    resourcePath: desktopResourcePath,
    getApplicationAllowlist: async () => (await settings.get()).computer.applicationAllowlist,
  });
  computerBroker = new ComputerHostToolBroker(nativeHostProviders.computer, new ComputerOverlay());
  documentBroker = new DocumentHostToolBroker(nativeHostProviders.documents, artifacts);
  const hostCapabilities = nativeHostProviders.capabilities;
  const eventCoordinator = new AgentEventCoordinator({
    taskTurns,
    checkpoints,
    taskProjector: taskProjector,
    getTitleGenerationService: () => titleGenerationService,
    getRemoteControlService: () => remoteControlService,
    logEvent: fields => logger.debug('agent.event', fields),
    onPersistenceError: fields => logger.error('task.event.persist.failed', fields),
    onTaskUpdated: updated => { broadcastToActiveWindows('task.updated', updated); },
    onAgentEvent: (projectRoot, event) => { broadcastToActiveWindows('agent.event', { cwd: projectRoot, event }); },
  });
  const agents = new AgentManager({
    onEvent: (projectRoot, event) => {
      const sessionId = typeof event.data['sessionId'] === 'string' ? event.data['sessionId'] : undefined;
      const isAutomationEvent = sessionId !== undefined && automationSessions.has(sessionId);
      eventCoordinator.observe(projectRoot, event, isAutomationEvent);
      if (event.event === 'approval.requested') {
        const sessionId = typeof event.data['sessionId'] === 'string' ? event.data['sessionId'] : undefined;
        const binding = sessionId === undefined ? undefined : automationSessions.get(sessionId);
        const executionBoundary = event.data['executionBoundary'] === 'sandbox' || event.data['executionBoundary'] === 'host' ? event.data['executionBoundary'] : undefined;
        const fallbackReason = typeof event.data['fallbackReason'] === 'string' ? event.data['fallbackReason'] : undefined;
        const approvalId = String(event.data['approvalId']);
        const toolName = String(event.data['toolName'] ?? 'tool');
        const displayName = formatToolDisplayName(event.data['toolName'], event.data['displayName']);
        const kind = String(event.data['kind'] ?? 'action');
        const detail = typeof event.data['detail'] === 'object' && event.data['detail'] !== null && !Array.isArray(event.data['detail']) ? event.data['detail'] as Record<string, unknown> : {};
        const commonInput: Omit<DesktopApprovalInput, 'source' | 'surface'> = { approvalId, toolName, displayName, kind, detail, ...(executionBoundary === undefined ? {} : { executionBoundary }), ...(fallbackReason === undefined ? {} : { fallbackReason }), risk: fallbackReason === undefined ? 'normal' : 'elevated', workspaceCwd: projectRoot, ...(typeof event.data['taskId'] === 'string' ? { taskId: event.data['taskId'] } : {}), ...(typeof event.data['sessionId'] === 'string' ? { sessionId: event.data['sessionId'] } : {}), ...(typeof event.data['turnId'] === 'string' ? { turnId: event.data['turnId'] } : {}) };
        if (binding !== undefined) {
          const approval: Omit<AutomationApproval, 'requestedAt'> = { approvalId, toolName, displayName, kind, detail, ...(executionBoundary === undefined ? {} : { executionBoundary }), ...(fallbackReason === undefined ? {} : { fallbackReason }) };
          void automations.requestApproval(binding.runId, approval, approved => agents.approvalRespond(binding.cwd, { approvalId, decision: approved ? 'allow' : 'deny' }), registered => {
            void approvals.request({ ...commonInput, source: 'automation', surface: 'automation' }, decision => automations.respondApproval(binding.runId, registered.approvalId, decision.decision === 'allow')).catch(error => logger.warn('approval.registration.failed', { approvalId, message: error instanceof Error ? error.message : 'Unable to register approval.' }));
          }).catch(error => logger.warn('automation.approval.registration.failed', { runId: binding.runId, message: error instanceof Error ? error.message : 'Unable to register automation approval.' }));
        } else {
          const source = toolName.startsWith('computer.') ? 'computer' : 'agent';
          void approvals.request({ ...commonInput, source, surface: 'composer' }, decision => agents.approvalRespond(projectRoot, { approvalId, decision: decision.decision, ...(decision.decision === 'redirect' ? { message: decision.message } : {}) }), { isAvailable: () => agents.isApprovalProcessAvailable(projectRoot, approvalId) }).catch(error => logger.warn('approval.registration.failed', { cwd: projectRoot, approvalId, message: error instanceof Error ? error.message : 'Unable to register approval.' }));
        }
      }
    },
    onDiagnostic: (projectRoot, diagnostic) => { logger[diagnostic.severity === 'error' ? 'error' : 'warn']('agent.diagnostic', { projectRoot, kind: diagnostic.kind, message: diagnostic.message, ...(diagnostic.sessionId === undefined ? {} : { sessionId: diagnostic.sessionId }), ...(diagnostic.turnId === undefined ? {} : { turnId: diagnostic.turnId }) }); broadcastToActiveWindows('agent.diagnostic', { cwd: projectRoot, diagnostic }); },
    onHostRequest: async (projectRoot, request, signal) => {
      if (request.tool === 'browser') return browserHost.handle(projectRoot, request, signal);
      if (request.tool === 'computer') {
        if (computerBroker === undefined) throw new Error('Computer Use is unavailable on this platform.');
        return computerBroker.handle(projectRoot, request, signal);
      }
      if (request.tool === 'document') {
        const broker = documentBroker;
        if (broker === undefined) throw new Error('Document tools are unavailable on this platform.');
        return checkpoints.withHostRequest(projectRoot, request, () => broker.handle(projectRoot, request, signal));
      }
      if (request.executionCwd === undefined) throw new Error('The CLI host request is missing its execution workspace.');
      return checkpoints.withHostRequest(projectRoot, request, () => hostExecution.handle(request.executionCwd as string, request, signal));
    },
    onExit: (projectRoot, error, sessionId, approvalIds = []) => {
      if (approvalIds.length > 0) void approvals.cancelWhere(request => approvalIds.includes(request.approvalId));
      if (sessionId !== undefined) {
        void browserHost.closeForSession(projectRoot, sessionId);
        if (computerBroker !== undefined) computerBroker.cancelForSession(projectRoot, sessionId);
        void documentBroker?.closeForSession(projectRoot, sessionId);
        void tasks.interruptActiveBySession(sessionId, error.message).catch(() => undefined);
        taskTurns.releaseSession(sessionId);
      }
      logger.error('agent.process.exit', { projectRoot, sessionId, approvalCount: approvalIds.length, error: error.message });
      broadcastToActiveWindows('agent.diagnostic', { cwd: projectRoot, diagnostic: { kind: 'protocol', severity: 'error', message: error.message, ...(sessionId === undefined ? {} : { sessionId }) } });
    },
  }, cache, async () => {
    const configured = await settings.get();
    return buildInteractiveDesktopExecutionPolicy(configured.sandbox.hostFallback);
  }, { computerHost: nativeHostProviders.capabilities.computer?.available === true, documentHost: Object.values(nativeHostProviders.capabilities.documents ?? {}).some(capability => capability?.available === true), hostCapabilities });
  agentManager = agents;
  const extensionFiles = new ExtensionFileService(workspaces, desktopResourcePath('public-plugins'), {
    listPublicPlugins: root => agents.extensionListPublicPlugins(root),
    resolvePublicPluginSource: (root, name) => agents.extensionResolvePublicPluginSource(root, name),
    readPublicPluginContribution: (root, input) => agents.extensionReadPublicPluginContribution(root, input),
    readDetail: (cwd, input) => agents.extensionReadDetail(cwd, input),
    readPluginIcon: (cwd, input) => agents.extensionReadPluginIcon(cwd, input),
  });
  void new PublicPluginBootstrapService(extensionFiles, agents, logger, app.getPath('userData')).run().catch(error => logger.warn('public.plugins.bootstrap.failed', { message: error instanceof Error ? error.message : 'Unable to bootstrap bundled public plugins.' }));
  titleGenerationService = new TaskTitleGenerationService(tasks, agents, logger);
  const git = new GitService();
  const automationExecution = new AutomationExecutionService({ workspaces, git, tasks, agents, settings, browserHost, artifacts, logger, sessions: automationSessions });
  const workspaceFileSuggestions = new WorkspaceFileSuggestions();
  const remoteControl = new RemoteControlService({ serverUrl: runtimeConfig.remoteServerUrl, globalPrefix: runtimeConfig.remoteServerGlobalPrefix, enrollmentToken: runtimeConfig.remoteServerEnrollmentToken, tasks, taskTurns, workspaces, workspaceFileSuggestions, agents, approvals, artifacts, settings, logger });
  remoteControlService = remoteControl;
  remoteControl.onState(event => {
    broadcastToActiveWindows('remote-control.state', event);
  });
  const executeAutomation = (automation: Parameters<AutomationExecutionService['execute']>[0], run: AutomationRun, signal: AbortSignal) => automationExecution.execute(automation, run, signal);
  const runAutomation = (id: string): Promise<AutomationRun> => automations.runNow(id, executeAutomation);
  const retryAutomation = (runId: string): Promise<AutomationRun> => automations.retry(runId, executeAutomation);
  const osScheduler = new AutomationOsScheduler(message => logger.warn('automation.scheduler', { message }));
  automations.onState(event => {
    remoteControl.publishAutomationState(event);
    void automations.list().then(items => osScheduler.sync(items)).catch(error => logger.warn('automation.scheduler.sync.failed', { message: error instanceof Error ? error.message : 'Unable to synchronize the automation scheduler.' }));
    broadcastToActiveWindows('automation.state', event);
    const run = event.run;
    if (event.type === 'reviewed' && run?.worktreePath !== undefined) void workspaces.require(event.automationId).then(workspace => cleanupAutomationWorkspace(git, workspace, run)).catch(error => logger.warn('automation.review.worktree.cleanup.failed', { runId: run?.id, message: error instanceof Error ? error.message : 'Unable to clean reviewed automation worktree.' }));
    if (run !== undefined && event.automation?.notifications) {
      const notification = automationNotification(event);
      if (notification !== undefined) operations.notify(notification.title, notification.body);
    }
  });
  const auth = new DesktopAuthService(transport, async () => { await remoteControl.stop(); await approvals.cancelAll(); await agents.shutdownAll(); await computerBroker?.close(); }, () => userContext.resetSession());
  registerIpc({ auth, userContext, agents, workspaces, workspaceFileSuggestions, tasks, taskTurns, checkpoints, extensionFiles, git, terminal: new TerminalService(workspaces, tasks, undefined, async () => (await settings.get()).sandbox.diagnosticsRetentionDays), interactiveTerminal: new InteractiveTerminalService(workspaces, settings), settings, artifacts, browser, automations, approvals, remoteControl, operations, speech, updates, runAutomation, retryAutomation, setMenuContext: setApplicationMenu, logger, onWorkspaceRemoved: async removedWorkspace => { await remoteControl.stop(); await approvals.cancelWhere(request => request.workspaceCwd === removedWorkspace.rootPath); await agents.shutdown(removedWorkspace.rootPath, 'workspace.removed'); taskTurns.releaseWorkspace(removedWorkspace.rootPath); await browserHost.closeForWorkspace(removedWorkspace.rootPath); await documentBroker?.closeForWorkspace(removedWorkspace.rootPath); } });
  await osScheduler.sync(await automations.list()).catch(error => logger.warn('automation.scheduler.sync.failed', { message: error instanceof Error ? error.message : 'Unable to synchronize the automation scheduler.' }));
  automationDispatchHandler = async () => { await automations.runDueNow(executeAutomation); };
  if (pendingAutomationDispatch) { pendingAutomationDispatch = false; await automationDispatchHandler(); }
  if (automationDispatchRequested) {
    await automationDispatchHandler();
    await approvals.cancelAll();
    await agents.shutdownAll('automation-dispatch');
    await browser.closeAll();
    app.quit();
    return;
  }
  automations.start(executeAutomation, 60_000);
  const openMainWindow = () => { const window = createMainWindow(); browser.attachWindow(window); return window; };
  openMainWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) openMainWindow();
  });
}).catch(error => {
  logger.error('app.startup.failed', { message: error instanceof Error ? error.message : 'Desktop startup failed.' });
  void logger.close().finally(() => app.quit());
});

app.on('window-all-closed', () => {
  logger.info('app.window-all-closed', { platform: process.platform });
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', (event) => {
  if (shuttingDown) return;
  event.preventDefault();
  shuttingDown = true;
  automationService?.stop();
  logger.info('app.before-quit', { windowCount: BrowserWindow.getAllWindows().length });

  const shutdownWatchdog = setTimeout(() => {
    logger.warn('app.shutdown.watchdog.expired', { timeoutMs: 5000 });
    app.exit(0);
  }, 5000);
  shutdownWatchdog.unref?.();

  void (async () => {
    await approvalCoordinator?.cancelAll();
    await remoteControlService?.stop();
    await agentManager?.shutdownAll('app.before-quit');
    await computerBroker?.close();
    await documentBroker?.closeForWorkspace(process.cwd());
    await taskProjector?.flush();
    await browserService?.closeAll();
  })().catch(error => logger.error('app.shutdown.failed', { message: error instanceof Error ? error.message : 'Desktop shutdown failed.' })).finally(async () => {
    clearTimeout(shutdownWatchdog);
    await logger.close().catch(() => undefined);
    app.quit();
  });
});
