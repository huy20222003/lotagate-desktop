import { randomUUID } from 'node:crypto';
import { desktopApprovalInputSchema, desktopApprovalRequestSchema, type DesktopApprovalDecision, type DesktopApprovalInput, type DesktopApprovalRequest, type DesktopApprovalResolution, type DesktopApprovalResponse } from '../../contracts/ipc/v1/approval.js';
import { DEFAULT_TIMEOUT_MS } from './approval-constants.js';

type PendingApproval = {
  request: DesktopApprovalRequest;
  resolve: (resolution: DesktopApprovalResolution) => void;
  reject: (reason: unknown) => void;
  onDecision?: (decision: DesktopApprovalDecision) => Promise<unknown>;
  isAvailable?: () => boolean;
  timer: ReturnType<typeof setTimeout>;
};

export class ApprovalCoordinator {
  private readonly pending = new Map<string, PendingApproval>();
  private readonly listeners = new Set<(request: DesktopApprovalRequest) => void>();
  private readonly resolutionListeners = new Set<(resolution: DesktopApprovalResolution) => void>();

  onRequest(listener: (request: DesktopApprovalRequest) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onResolved(listener: (resolution: DesktopApprovalResolution) => void): () => void {
    this.resolutionListeners.add(listener);
    return () => this.resolutionListeners.delete(listener);
  }

  listPending(): DesktopApprovalRequest[] {
    return [...this.pending.values()].map(item => item.request);
  }

  request(input: DesktopApprovalInput, onDecision?: (decision: DesktopApprovalDecision) => Promise<unknown>, options?: { isAvailable?: () => boolean }): Promise<DesktopApprovalResolution> {
    const parsed = desktopApprovalInputSchema.parse(input);
    const request = desktopApprovalRequestSchema.parse({ ...parsed, approvalId: parsed.approvalId ?? randomUUID(), requestedAt: new Date().toISOString() });
    if (this.pending.has(request.approvalId)) throw new Error('An approval with this id is already pending.');
    return new Promise<DesktopApprovalResolution>((resolve, reject) => {
      const timer = setTimeout(() => this.expire(request.approvalId), request.timeoutMs ?? DEFAULT_TIMEOUT_MS);
      this.pending.set(request.approvalId, { request, resolve, reject, ...(onDecision === undefined ? {} : { onDecision }), ...(options?.isAvailable === undefined ? {} : { isAvailable: options.isAvailable }), timer });
      for (const listener of this.listeners) listener(request);
    });
  }

  async respond(approvalId: string, response: DesktopApprovalResponse, owner?: { taskId?: string; sessionId?: string }): Promise<DesktopApprovalResolution> {
    const pending = this.pending.get(approvalId);
    if (pending === undefined) throw new Error('This approval is no longer active.');
    if (!approvalOwnerMatches(pending.request, owner)) throw new Error('This approval belongs to a different session.');
    const decision = normalizeDecision(response);
    this.pending.delete(approvalId);
    clearTimeout(pending.timer);
    if (pending.isAvailable?.() === false) {
      const resolution = { approvalId, approved: false, decision: 'deny' as const };
      pending.resolve(resolution);
      for (const listener of this.resolutionListeners) listener(resolution);
      return resolution;
    }
    try {
      const result = pending.onDecision === undefined ? undefined : await pending.onDecision(decision);
      const resolution = { approvalId, approved: decision.decision === 'allow', decision: decision.decision, ...(decision.decision === 'redirect' ? { message: decision.message } : {}), ...(result === undefined ? {} : { result }) };
      pending.resolve(resolution);
      for (const listener of this.resolutionListeners) listener(resolution);
      return resolution;
    } catch (error) {
      if (pending.isAvailable?.() === false) {
        const resolution = { approvalId, approved: false, decision: 'deny' as const };
        pending.resolve(resolution);
        for (const listener of this.resolutionListeners) listener(resolution);
        return resolution;
      }
      pending.reject(error);
      throw error;
    }
  }

  async cancelAll(): Promise<void> {
    await this.cancelWhere(() => true);
  }

  async cancelWhere(predicate: (request: DesktopApprovalRequest) => boolean, options: { notifyDecision?: boolean } = {}): Promise<void> {
    const pending = [...this.pending.values()].filter(item => predicate(item.request));
    await Promise.all(pending.map(async item => {
      if (options.notifyDecision === false) {
        this.resolveCancelled(item);
        return;
      }
      try { await this.respond(item.request.approvalId, false, { ...(item.request.taskId === undefined ? {} : { taskId: item.request.taskId }), ...(item.request.sessionId === undefined ? {} : { sessionId: item.request.sessionId }) }); } catch { /* already resolved */ }
    }));
  }

  private resolveCancelled(pending: PendingApproval): void {
    if (!this.pending.delete(pending.request.approvalId)) return;
    clearTimeout(pending.timer);
    const resolution = { approvalId: pending.request.approvalId, approved: false, decision: 'deny' as const };
    pending.resolve(resolution);
    for (const listener of this.resolutionListeners) listener(resolution);
  }

  private expire(approvalId: string): void {
    const pending = this.pending.get(approvalId);
    if (pending !== undefined) this.resolveCancelled(pending);
  }
}

function normalizeDecision(response: DesktopApprovalResponse): DesktopApprovalDecision {
  if (typeof response === 'boolean') return { decision: response ? 'allow' : 'deny' };
  if (response.decision === 'redirect' && response.message.trim().length === 0) throw new Error('Approval redirect requires a message.');
  return response;
}

function approvalOwnerMatches(request: DesktopApprovalRequest, owner: { taskId?: string; sessionId?: string } | undefined): boolean {
  if (owner === undefined) return request.taskId === undefined && request.sessionId === undefined;
  if (request.taskId !== undefined && owner.taskId !== request.taskId) return false;
  if (request.sessionId !== undefined && owner.sessionId !== request.sessionId) return false;
  return true;
}
