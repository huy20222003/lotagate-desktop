import type { DesktopExecutionPolicy } from '../../contracts/agent-protocol/v1/desktop.js';

export const INTERACTIVE_DESKTOP_EXECUTION_POLICY: DesktopExecutionPolicy = {
  permissionPolicy: 'ask',
  browserAccess: 'interactive',
  timeoutMs: 60 * 60 * 1_000,
};
