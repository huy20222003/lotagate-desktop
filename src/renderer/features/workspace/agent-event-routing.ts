export function allowsUnscopedTaskFallback(event: string, sessionId: string | undefined, turnId: string | undefined): boolean {
  return sessionId === undefined && turnId === undefined && !event.startsWith('command.');
}
