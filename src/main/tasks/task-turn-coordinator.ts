import { randomUUID } from 'node:crypto';
import type { DesktopEvent } from '../../contracts/agent-protocol/v1/desktop.js';

interface TaskTurnClaim { token: string; workspaceRoot: string; sessionId?: string }

/** Coordinates turn ownership for every Desktop entry point in the main process. */
export class TaskTurnCoordinator {
  private readonly claims = new Map<string, TaskTurnClaim>();

  claim(taskId: string, workspaceRoot: string, sessionId?: string): string {
    if (this.claims.has(taskId)) throw new Error('The task already has a turn in progress.');
    const token = randomUUID();
    this.claims.set(taskId, { token, workspaceRoot, ...(sessionId === undefined ? {} : { sessionId }) });
    return token;
  }

  bind(taskId: string, token: string, sessionId: string): void {
    const claim = this.claims.get(taskId);
    if (claim?.token !== token) throw new Error('The task turn claim is invalid or expired.');
    if (claim.sessionId !== undefined && claim.sessionId !== sessionId) throw new Error('The task turn claim belongs to a different session.');
    this.claims.set(taskId, { ...claim, sessionId });
  }

  release(taskId: string, token: string): void {
    if (this.claims.get(taskId)?.token === token) this.claims.delete(taskId);
  }

  owns(taskId: string, token: string): boolean { return this.claims.get(taskId)?.token === token; }

  observe(taskId: string | undefined, event: DesktopEvent): void {
    if (taskId === undefined || !['turn.completed', 'turn.failed', 'turn.cancelled'].includes(event.event)) return;
    const claim = this.claims.get(taskId);
    const sessionId = typeof event.data['sessionId'] === 'string' ? event.data['sessionId'] : undefined;
    if (claim !== undefined && ((claim.sessionId === undefined && sessionId === undefined) || claim.sessionId === sessionId)) this.claims.delete(taskId);
  }

  releaseSession(sessionId: string): void {
    for (const [taskId, claim] of this.claims) if (claim.sessionId === sessionId) this.claims.delete(taskId);
  }

  releaseWorkspace(workspaceRoot: string): void {
    for (const [taskId, claim] of this.claims) if (claim.workspaceRoot === workspaceRoot) this.claims.delete(taskId);
  }
}
