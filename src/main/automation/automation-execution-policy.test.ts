import { describe, expect, it } from 'vitest';
import { buildAutomationExecutionPolicy, supportsAutomationExecution } from './automation-execution-policy.js';
import type { Automation } from '../../contracts/ipc/v1/automation.js';

const automation = { permissionPolicy: 'ask', browserAccess: 'disabled', tools: [], timeoutMs: 60 * 60 * 1_000 } as unknown as Automation;

describe('automation execution policy', () => {
  it('always serializes the new execution context for every automation run', () => {
    expect(buildAutomationExecutionPolicy(automation, 1)).toEqual({
      permissionPolicy: 'ask',
      browserAccess: 'disabled',
      timeoutMs: 60 * 60 * 1_000,
      retryAttempt: 0,
    });
  });

  it('serializes policy fields only when the automation needs them', () => {
    expect(buildAutomationExecutionPolicy({ ...automation, permissionPolicy: 'allowlist', tools: ['filesystem.read'] }, 2)).toEqual({
      permissionPolicy: 'allowlist',
      allowedTools: ['filesystem.read'],
      browserAccess: 'disabled',
      timeoutMs: 60 * 60 * 1_000,
      retryAttempt: 1,
    });
  });

  it('detects the CLI capability required for the Desktop execution protocol', () => {
    expect(supportsAutomationExecution(['sessions', 'browser-host'])).toBe(false);
    expect(supportsAutomationExecution(['sessions', 'execution-context'])).toBe(true);
  });
});
