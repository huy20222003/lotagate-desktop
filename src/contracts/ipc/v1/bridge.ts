import type { DesktopRendererAuthApi } from './auth.js';
import type { ExtensionDetail, ExtensionDetailInput, ExtensionDetailWriteInput, HookCreateInput, HookRemoveInput, PluginIcon, PluginIconInput, PublicPluginCatalogEntry, PublicPluginContributionInput } from './extensions.js';
import type { DesktopAgentResult } from '../../agent-protocol/v1/desktop.js';
import type { DesktopWorkspaceApi, DesktopTaskApi, DesktopCheckpointApi, AgentEventEnvelope, AgentDiagnosticEnvelope, DesktopGitApi, DesktopTerminalApi, DesktopSettingsApi, DesktopAutomationApi, DesktopBrowserApi } from './workspace.js';
import type { DesktopApprovalApi } from './approval.js';
import type { DesktopRemoteControlApi } from '../../remote-control/v1/remote-control.js';
import type { DesktopUpdatesApi } from './update.js';
import type { DesktopSpeechApi } from './speech.js';

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
    paymentHistory(organizationCode: string, page?: number, limit?: number): Promise<unknown>;
    workspaces(code: string): Promise<unknown>;
    models(organizationCode: string, workspaceCode: string): Promise<unknown>;
  };
  agent: {
    initialize(cwd: string): Promise<DesktopAgentResult>;
    sessionCreate(cwd: string, input: { model?: string; name?: string }): Promise<unknown>;
    sessionList(cwd: string): Promise<unknown>;
    sessionResume(cwd: string, sessionId: string): Promise<unknown>;
    uploadAttachment(cwd: string, input: { sessionId: string; taskId: string; attachmentId: string }): Promise<void>;
    deleteAttachment(cwd: string, input: { sessionId: string; taskId: string; attachmentId: string }): Promise<void>;
    turnClaim(cwd: string, taskId: string, sessionId?: string): Promise<string>;
    turnRelease(taskId: string, token: string): Promise<void>;
    turnStart(cwd: string, input: { sessionId: string; prompt: string; model?: string; reasoningEffort?: import('../../agent-protocol/v1/desktop.js').DesktopReasoningEffort; runId?: string; taskId?: string; sessionName?: string; execution?: import('../../agent-protocol/v1/desktop.js').DesktopExecutionPolicy; skills?: string[]; attachmentIds?: string[]; turnClaimToken?: string }): Promise<unknown>;
    turnCancel(cwd: string, turnId: string): Promise<unknown>;
    trustRespond(cwd: string, input: { trustRequestId: string; trusted: boolean }): Promise<unknown>;
    modelList(cwd: string): Promise<unknown>;
    commandList(cwd: string): Promise<unknown>;
    commandExecute(cwd: string, input: Record<string, unknown>): Promise<unknown>;
    commandCancel(cwd: string, commandId: string): Promise<unknown>;
    shutdown(cwd: string): Promise<void>;
    onEvent(listener: (envelope: AgentEventEnvelope) => void): () => void;
    onDiagnostic(listener: (envelope: AgentDiagnosticEnvelope) => void): () => void;
  };
  workspaces: DesktopWorkspaceApi;
  checkpoints: DesktopCheckpointApi;
  tasks: DesktopTaskApi;
  extensions: {
    readDetail(input: ExtensionDetailInput): Promise<ExtensionDetail>;
    readPluginIcon(input: PluginIconInput): Promise<PluginIcon | undefined>;
    listPublicPlugins(): Promise<readonly PublicPluginCatalogEntry[]>;
    resolvePublicPluginSource(name: string): Promise<string>;
    readPublicPluginContribution(input: PublicPluginContributionInput): Promise<ExtensionDetail>;
    writeDetail(input: ExtensionDetailWriteInput): Promise<void>;
    listProjectHooks(cwd: string): Promise<string[]>;
    createHook(input: HookCreateInput): Promise<{ name: string }>;
    removeHook(input: HookRemoveInput): Promise<void>;
  };
  git: DesktopGitApi;
  terminal: DesktopTerminalApi;
  settings: DesktopSettingsApi;
  automations: DesktopAutomationApi;
  browser: DesktopBrowserApi;
  approvals: DesktopApprovalApi;
  remoteControl: DesktopRemoteControlApi;
  updates: DesktopUpdatesApi;
  speech: DesktopSpeechApi;
  operations: {
    notify(title: string, body: string): Promise<void>;
    showWindow(): Promise<void>;
    revealPath(path: string): Promise<void>;
    openFile(path: string, destination?: import('./settings.js').FileOpenDestination): Promise<void>;
    listDirectory(path: string): Promise<import('./workspace.js').WorkspaceFileSuggestion[]>;
    readFile(path: string): Promise<string>;
    previewFile(path: string): Promise<import('./workspace.js').DesktopFilePreview>;
    exportDiagnostics(): Promise<string>;
    onDeepLink(listener: (url: string) => void): () => void;
  };
  runtime: {
    getVersion(): Promise<string>;
  };
}
