import type { DesktopIpcServices } from './ipc-types.js';
import { createIpcRegistrationContext } from './ipc-registration-context.js';
import { registerCoreIpcHandlers } from './register-core-ipc.js';
import { registerAgentIpcHandlers } from './register-agent-ipc.js';
import { registerWorkspaceIpcHandlers } from './register-workspace-ipc.js';
import { registerTaskIpcHandlers } from './register-task-ipc.js';
import { registerGitExtensionIpcHandlers } from './register-git-extension-ipc.js';
import { registerTerminalIpcHandlers } from './register-terminal-ipc.js';
import { registerRuntimeIpcHandlers } from './register-runtime-ipc.js';

export type { DesktopIpcServices } from './ipc-types.js';

export function registerIpc(services: DesktopIpcServices): void {
  const context = createIpcRegistrationContext(services);
  registerCoreIpcHandlers(context);
  registerAgentIpcHandlers(context);
  registerWorkspaceIpcHandlers(context);
  registerTaskIpcHandlers(context);
  registerGitExtensionIpcHandlers(context);
  registerTerminalIpcHandlers(context);
  registerRuntimeIpcHandlers(context);
}
