import type { DesktopRendererAuthApi } from './auth.js';
import type { DesktopAgentResult } from '../../agent-protocol/v1/desktop.js';
import type { DesktopWorkspaceApi, DesktopTaskApi, AgentEventEnvelope, DesktopGitApi, DesktopTerminalApi, DesktopSettingsApi, DesktopAutomationApi, DesktopBrowserApi } from './workspace.js';

export interface DesktopBridge {
  menu: {
    onCommand(listener: (command: 'newTask' | 'openWorkspace') => void): () => void;
    setContext(context: 'login' | 'workspace'): Promise<void>;
  };
  auth: DesktopRendererAuthApi;
  userContext: {
    organizations(): Promise<unknown>;
    organization(code: string): Promise<unknown>;
    wallet(code: string): Promise<unknown>;
    usage(organizationCode: string, workspaceCode?: string): Promise<unknown>;
    dashboardStats(organizationCode: string, workspaceCode?: string): Promise<unknown>;
    workspaces(code: string): Promise<unknown>;
    models(organizationCode: string, workspaceCode: string): Promise<unknown>;
  };
  agent: {
    initialize(cwd: string): Promise<DesktopAgentResult>;
    sessionCreate(cwd: string, input: { model?: string; name?: string }): Promise<unknown>;
    sessionList(cwd: string): Promise<unknown>;
    sessionResume(cwd: string, sessionId: string): Promise<unknown>;
    turnStart(cwd: string, input: { sessionId: string; prompt: string; model?: string; taskId?: string; attachmentIds?: string[] }): Promise<unknown>;
    turnCancel(cwd: string, turnId: string): Promise<unknown>;
    approvalRespond(cwd: string, input: { approvalId: string; approved: boolean }): Promise<unknown>;
    trustRespond(cwd: string, input: { trustRequestId: string; trusted: boolean }): Promise<unknown>;
    modelList(cwd: string): Promise<unknown>;
    commandList(cwd: string): Promise<unknown>;
    commandExecute(cwd: string, input: Record<string, unknown>): Promise<unknown>;
    commandCancel(cwd: string, commandId: string): Promise<unknown>;
    shutdown(cwd: string): Promise<void>;
    onEvent(listener: (envelope: AgentEventEnvelope) => void): () => void;
  };
  workspaces: DesktopWorkspaceApi;
  tasks: DesktopTaskApi;
  git: DesktopGitApi;
  terminal: DesktopTerminalApi;
  settings: DesktopSettingsApi;
  automations: DesktopAutomationApi;
  browser: DesktopBrowserApi;
  operations: {
    notify(title: string, body: string): Promise<void>;
    showWindow(): Promise<void>;
    exportDiagnostics(): Promise<string>;
    checkForUpdates(): Promise<Record<string, string> | null>;
    onDeepLink(listener: (url: string) => void): () => void;
  };
  runtime: {
    getVersion(): Promise<string>;
  };
}
