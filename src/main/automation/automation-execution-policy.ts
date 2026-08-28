import type { DesktopExecutionPolicy } from '../../contracts/agent-protocol/v1/desktop.js';
import type { Automation } from '../../contracts/ipc/v1/automation.js';

export function buildAutomationExecutionPolicy(automation: Automation, attempt: number): DesktopExecutionPolicy {
  return {
    permissionPolicy: automation.permissionPolicy,
    ...(automation.tools.length === 0 && automation.permissionPolicy !== 'allowlist' ? {} : { allowedTools: automation.tools }),
    browserAccess: automation.browserAccess,
    isolation: 'sandbox',
    hostFallback: automation.permissionPolicy === 'autonomous' ? 'deny' : 'ask',
    timeoutMs: automation.timeoutMs,
    retryAttempt: Math.max(0, attempt - 1),
  };
}

export function supportsAutomationExecution(capabilities: readonly string[]): boolean {
  return capabilities.includes('execution-context') && capabilities.includes('execution-broker');
}
