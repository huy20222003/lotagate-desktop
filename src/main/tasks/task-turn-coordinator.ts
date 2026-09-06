import { randomUUID } from 'node:crypto';
import type { DesktopEvent } from '../../contracts/agent-protocol/v1/desktop.js';

interface TaskTurnClaim { token: string; workspaceRoot: string }

/** Coordinates turn ownership for every Desktop entry point in the main process. */
export class TaskTurnCoordinator {
  private readonly claims = new Map<string, TaskTurnClaim>();

  claim(taskId: string, workspaceRoot: string): string {
    if (this.claims.has(taskId)) throw new Error('The task already has a turn in progress.');
    const token = randomUUID();
    this.claims.set(taskId, { token, workspaceRoot });
    return token;
  }

  release(taskId: string, token: string): void {
    if (this.claims.get(taskId)?.token === token) this.claims.delete(taskId);
  }

  owns(taskId: string, token: string): boolean { return this.claims.get(taskId)?.token === token; }

  observe(taskId: string | undefined, event: DesktopEvent): void {
    if (taskId === undefined || !['turn.completed', 'turn.failed', 'turn.cancelled'].includes(event.event)) return;
    this.claims.delete(taskId);
  }

  releaseWorkspace(workspaceRoot: string): void {
    for (const [taskId, claim] of this.claims) if (claim.workspaceRoot === workspaceRoot) this.claims.delete(taskId);
  }
}
