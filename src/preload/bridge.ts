import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopBridge } from '../contracts/ipc/v1/bridge.js';
import type { AgentEventEnvelope } from '../contracts/ipc/v1/workspace.js';

const bridge: DesktopBridge = {
  menu: {
    setContext: context => ipcRenderer.invoke('menu.setContext', context),
    onCommand: listener => {
      const handler = (_event: Electron.IpcRendererEvent, command: 'newTask' | 'openWorkspace') => listener(command);
      ipcRenderer.on('menu.command', handler);
      return () => ipcRenderer.removeListener('menu.command', handler);
    },
  },
  auth: {
    getCurrentUser: () => ipcRenderer.invoke('auth.getCurrentUser'),
    restoreSession: () => ipcRenderer.invoke('auth.restoreSession'),
    login: (input) => ipcRenderer.invoke('auth.login', input),
    logout: () => ipcRenderer.invoke('auth.logout'),
    onSessionExpired: listener => {
      const handler = () => listener();
      ipcRenderer.on('auth.sessionExpired', handler);
      return () => ipcRenderer.removeListener('auth.sessionExpired', handler);
    },
  },
  userContext: {
    organizations: () => ipcRenderer.invoke('userContext.organizations'),
    organization: code => ipcRenderer.invoke('userContext.organization', code),
    wallet: code => ipcRenderer.invoke('userContext.wallet', code),
    usage: (organizationCode, workspaceCode) => ipcRenderer.invoke('userContext.usage', organizationCode, workspaceCode),
    dashboardStats: (organizationCode, workspaceCode) => ipcRenderer.invoke('userContext.dashboardStats', organizationCode, workspaceCode),
    workspaces: code => ipcRenderer.invoke('userContext.workspaces', code),
    models: (organizationCode, workspaceCode) => ipcRenderer.invoke('userContext.models', organizationCode, workspaceCode),
  },
  runtime: {
    getVersion: () => ipcRenderer.invoke('runtime.getVersion'),
  },
  agent: {
    initialize: (cwd: string) => ipcRenderer.invoke('agent.initialize', cwd),
    sessionCreate: (cwd, input) => ipcRenderer.invoke('agent.sessionCreate', cwd, input),
    sessionList: cwd => ipcRenderer.invoke('agent.sessionList', cwd),
    sessionResume: (cwd, sessionId) => ipcRenderer.invoke('agent.sessionResume', cwd, sessionId),
    turnStart: (cwd, input) => ipcRenderer.invoke('agent.turnStart', cwd, input),
    turnCancel: (cwd, turnId) => ipcRenderer.invoke('agent.turnCancel', cwd, turnId),
    approvalRespond: (cwd, input) => ipcRenderer.invoke('agent.approvalRespond', cwd, input),
    trustRespond: (cwd, input) => ipcRenderer.invoke('agent.trustRespond', cwd, input),
    modelList: cwd => ipcRenderer.invoke('agent.modelList', cwd),
    commandList: cwd => ipcRenderer.invoke('agent.commandList', cwd),
    commandExecute: (cwd, input) => ipcRenderer.invoke('agent.commandExecute', cwd, input),
    commandCancel: (cwd, commandId) => ipcRenderer.invoke('agent.commandCancel', cwd, commandId),
    shutdown: (cwd: string) => ipcRenderer.invoke('agent.shutdown', cwd),
    onEvent: (listener: (envelope: AgentEventEnvelope) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, value: AgentEventEnvelope) => listener(value);
      ipcRenderer.on('agent.event', handler);
      return () => ipcRenderer.removeListener('agent.event', handler);
    },
  },
  workspaces: {
    list: () => ipcRenderer.invoke('workspace.list'),
    pickFolder: () => ipcRenderer.invoke('workspace.pickFolder'),
    add: rootPath => ipcRenderer.invoke('workspace.add', rootPath),
    addRoot: (workspaceId, rootPath) => ipcRenderer.invoke('workspace.addRoot', workspaceId, rootPath),
    rename: (workspaceId, name) => ipcRenderer.invoke('workspace.rename', workspaceId, name),
    reorder: workspaceIds => ipcRenderer.invoke('workspace.reorder', workspaceIds),
    updateSettings: (workspaceId, patch) => ipcRenderer.invoke('workspace.settings', workspaceId, patch),
    remove: workspaceId => ipcRenderer.invoke('workspace.remove', workspaceId),
    trust: (workspaceId, trusted) => ipcRenderer.invoke('workspace.trust', workspaceId, trusted),
    fileSuggestions: (rootPath, query) => ipcRenderer.invoke('workspace.fileSuggestions', rootPath, query),
  },
  tasks: {
    list: workspaceId => ipcRenderer.invoke('task.list', workspaceId),
    create: input => ipcRenderer.invoke('task.create', input),
    update: (taskId, patch) => ipcRenderer.invoke('task.update', taskId, patch),
    setStatus: (taskId, status) => ipcRenderer.invoke('task.status', taskId, status),
    retry: taskId => ipcRenderer.invoke('task.retry', taskId),
    cancel: taskId => ipcRenderer.invoke('task.cancel', taskId),
    resume: taskId => ipcRenderer.invoke('task.resume', taskId),
    archive: (taskId, archived) => ipcRenderer.invoke('task.archive', taskId, archived),
    pin: (taskId, pinned) => ipcRenderer.invoke('task.pin', taskId, pinned),
    addActivity: (taskId, kind, text, metadata) => ipcRenderer.invoke('task.activity', taskId, kind, text, metadata),
    activities: taskId => ipcRenderer.invoke('task.activities', taskId),
    artifacts: taskId => ipcRenderer.invoke('task.artifacts', taskId),
    pickArtifact: taskId => ipcRenderer.invoke('task.pickArtifact', taskId),
    createTextArtifact: (taskId, name, content, kind) => ipcRenderer.invoke('task.createTextArtifact', taskId, name, content, kind),
    createImageArtifact: (taskId, name, bytes) => ipcRenderer.invoke('task.createImageArtifact', taskId, name, bytes),
    deleteArtifact: (taskId, artifactId, confirmed) => ipcRenderer.invoke('task.deleteArtifact', taskId, artifactId, confirmed),
    previewArtifact: (taskId, artifactId) => ipcRenderer.invoke('task.previewArtifact', taskId, artifactId),
    openArtifact: (taskId, artifactId) => ipcRenderer.invoke('task.openArtifact', taskId, artifactId),
  },
  extensions: {
    readDetail: input => ipcRenderer.invoke('extension.readDetail', input),
    writeDetail: input => ipcRenderer.invoke('extension.writeDetail', input),
    listProjectHooks: cwd => ipcRenderer.invoke('extension.listProjectHooks', cwd),
    createHook: input => ipcRenderer.invoke('extension.createHook', input),
    removeHook: input => ipcRenderer.invoke('extension.removeHook', input),
  },
  git: {
    status: cwd => ipcRenderer.invoke('git.status', cwd),
    diff: (cwd, staged) => ipcRenderer.invoke('git.diff', cwd, staged),
    branches: cwd => ipcRenderer.invoke('git.branches', cwd),
    stage: (cwd, path) => ipcRenderer.invoke('git.stage', cwd, path),
    unstage: (cwd, path) => ipcRenderer.invoke('git.unstage', cwd, path),
    commit: (cwd, message) => ipcRenderer.invoke('git.commit', cwd, message),
    createBranch: (cwd, branch) => ipcRenderer.invoke('git.createBranch', cwd, branch),
    exportPatch: (cwd, staged) => ipcRenderer.invoke('git.exportPatch', cwd, staged),
    worktreeAdd: (cwd, path, branch) => ipcRenderer.invoke('git.worktreeAdd', cwd, path, branch),
    worktreeRemove: (cwd, path, confirmed) => ipcRenderer.invoke('git.worktreeRemove', cwd, path, confirmed),
    restore: (cwd, path, confirmed) => ipcRenderer.invoke('git.restore', cwd, path, confirmed),
  },
  terminal: { execute: input => ipcRenderer.invoke('terminal.execute', input), list: taskId => ipcRenderer.invoke('terminal.list', taskId) },
  settings: { get: () => ipcRenderer.invoke('settings.get'), update: patch => ipcRenderer.invoke('settings.update', patch) },
  automations: {
    list: () => ipcRenderer.invoke('automation.list'),
    create: input => ipcRenderer.invoke('automation.create', input),
    update: (id, patch) => ipcRenderer.invoke('automation.update', id, patch),
    remove: id => ipcRenderer.invoke('automation.remove', id),
    run: id => ipcRenderer.invoke('automation.run', id),
  },
  browser: {
    open: (url, approved) => ipcRenderer.invoke('browser.open', url, approved),
    close: id => ipcRenderer.invoke('browser.close', id),
    screenshot: id => ipcRenderer.invoke('browser.screenshot', id),
    startRecording: id => ipcRenderer.invoke('browser.startRecording', id),
    stopRecording: id => ipcRenderer.invoke('browser.stopRecording', id),
    list: () => ipcRenderer.invoke('browser.list'),
    evidence: id => ipcRenderer.invoke('browser.evidence', id),
  },
  operations: { notify: (title, body) => ipcRenderer.invoke('operations.notify', title, body), showWindow: () => ipcRenderer.invoke('operations.showWindow'), exportDiagnostics: () => ipcRenderer.invoke('operations.exportDiagnostics'), checkForUpdates: () => ipcRenderer.invoke('operations.checkForUpdates'), onDeepLink: listener => { const handler = (_event: Electron.IpcRendererEvent, url: string) => listener(url); ipcRenderer.on('operations.deepLink', handler); return () => ipcRenderer.removeListener('operations.deepLink', handler); } },
};

contextBridge.exposeInMainWorld('lotagate', bridge);
