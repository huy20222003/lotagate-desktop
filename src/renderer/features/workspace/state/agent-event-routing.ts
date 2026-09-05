export function allowsUnscopedTaskFallback(event: string, sessionId: string | undefined, turnId: string | undefined): boolean {
  return sessionId === undefined && turnId === undefined && !event.startsWith('command.');
}

export function shouldSurfaceAgentDiagnostic(input: {
  cwd: string;
  workspaceRoot: string | undefined;
  taskSessionId: string | undefined;
  activeTurnId: string | undefined;
  diagnostic: { kind: 'stderr' | 'protocol'; severity?: 'info' | 'error'; sessionId?: string; turnId?: string };
}): boolean {
  if (input.cwd !== input.workspaceRoot || input.diagnostic.kind !== 'protocol' || input.diagnostic.severity !== 'error') return false;
  if (input.diagnostic.sessionId === undefined && input.diagnostic.turnId === undefined) return false;
  if (input.diagnostic.sessionId !== undefined && input.diagnostic.sessionId !== input.taskSessionId) return false;
  return input.diagnostic.turnId === undefined || input.diagnostic.turnId === input.activeTurnId;
}
