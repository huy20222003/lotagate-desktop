import { describe, expect, it } from 'vitest';
import { shouldSurfaceAgentDiagnostic } from './agent-event-routing.js';
import { allowsUnscopedTaskFallback } from './agent-event-routing.js';

describe('allowsUnscopedTaskFallback', () => {
  it('does not route background command events to the selected conversation', () => {
    expect(allowsUnscopedTaskFallback('command.started', undefined, undefined)).toBe(false);
    expect(allowsUnscopedTaskFallback('command.activity.started', undefined, undefined)).toBe(false);
  });

  it('keeps unscoped agent events associated with a single active task', () => {
    expect(allowsUnscopedTaskFallback('tool.started', undefined, undefined)).toBe(true);
    expect(allowsUnscopedTaskFallback('turn.started', undefined, undefined)).toBe(true);
    expect(allowsUnscopedTaskFallback('turn.started', 'session-id', undefined)).toBe(false);
  });
});

describe('agent diagnostic routing', () => {
  const base = {
    cwd: 'C:\\workspace',
    workspaceRoot: 'C:\\workspace',
    taskSessionId: 'session-1',
    activeTurnId: 'turn-1',
  };

  it('surfaces an error for the matching session', () => {
    expect(shouldSurfaceAgentDiagnostic({ ...base, diagnostic: { kind: 'protocol', severity: 'error', sessionId: 'session-1' } })).toBe(true);
  });

  it('ignores informational event diagnostics and other sessions', () => {
    expect(shouldSurfaceAgentDiagnostic({ ...base, diagnostic: { kind: 'protocol', sessionId: 'session-1' } })).toBe(false);
    expect(shouldSurfaceAgentDiagnostic({ ...base, diagnostic: { kind: 'protocol', severity: 'error', sessionId: 'session-2' } })).toBe(false);
  });

  it('requires a matching turn for turn-scoped errors', () => {
    expect(shouldSurfaceAgentDiagnostic({ ...base, diagnostic: { kind: 'protocol', severity: 'error', sessionId: 'session-1', turnId: 'turn-2' } })).toBe(false);
    expect(shouldSurfaceAgentDiagnostic({ ...base, diagnostic: { kind: 'protocol', severity: 'error', sessionId: 'session-1', turnId: 'turn-1' } })).toBe(true);
  });
});
