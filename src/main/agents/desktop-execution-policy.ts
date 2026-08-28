import type { DesktopExecutionPolicy } from '../../contracts/agent-protocol/v1/desktop.js';
import type { SandboxHostFallback } from '../../contracts/ipc/v1/settings.js';

export const INTERACTIVE_DESKTOP_EXECUTION_POLICY: DesktopExecutionPolicy = {
  permissionPolicy: 'ask',
  browserAccess: 'interactive',
  isolation: 'sandbox',
  hostFallback: 'ask',
  timeoutMs: 60 * 60 * 1_000,
};

export function buildInteractiveDesktopExecutionPolicy(hostFallback: SandboxHostFallback = 'ask'): DesktopExecutionPolicy {
  return { ...INTERACTIVE_DESKTOP_EXECUTION_POLICY, hostFallback };
}
