import { describe, expect, it, vi } from 'vitest';
import { ApprovalCoordinator } from './approval-coordinator.js';

describe('ApprovalCoordinator', () => {
  it('publishes one request and resolves the registered action from the shared decision', async () => {
    const coordinator = new ApprovalCoordinator();
    const onRequest = vi.fn();
    const onDecision = vi.fn().mockResolvedValue({ status: 'done' });
    coordinator.onRequest(onRequest);
    const pending = coordinator.request({ source: 'git', surface: 'composer', toolName: 'git.push', displayName: 'Push', kind: 'git', detail: { summary: 'Publish changes.' }, risk: 'elevated' }, onDecision);
    expect(onRequest).toHaveBeenCalledTimes(1);
    const request = onRequest.mock.calls[0]?.[0];
    expect(request?.toolName).toBe('git.push');
    const resolution = await coordinator.respond(request!.approvalId, true);
    expect(await pending).toMatchObject({ approvalId: request!.approvalId, approved: true });
    expect(resolution.result).toEqual({ status: 'done' });
    expect(onDecision).toHaveBeenCalledWith(true);
  });

  it('rejects a second response after the approval has been resolved', async () => {
    const coordinator = new ApprovalCoordinator();
    const listener = vi.fn();
    coordinator.onRequest(listener);
    const pending = coordinator.request({ source: 'browser', surface: 'composer', toolName: 'browser.navigate', detail: { summary: 'Navigate.' } });
    const request = listener.mock.calls[0]?.[0];
    await coordinator.respond(request!.approvalId, false);
    await expect(coordinator.respond(request!.approvalId, true)).rejects.toThrow('no longer active');
    await expect(pending).resolves.toMatchObject({ approvalId: request!.approvalId, approved: false });
  });

  it('exposes a snapshot of active approvals without exposing coordinator internals', () => {
    const coordinator = new ApprovalCoordinator();
    const pending = coordinator.request({ source: 'agent', surface: 'composer', toolName: 'filesystem.write', detail: { path: 'file.txt' } });
    const request = coordinator.listPending()[0];

    expect(request).toMatchObject({ toolName: 'filesystem.write' });
    expect(coordinator.listPending()).toHaveLength(1);
    void coordinator.respond(request!.approvalId, false);
    return pending;
  });

  it('rejects a response from a different session owner', async () => {
    const coordinator = new ApprovalCoordinator();
    const listener = vi.fn();
    coordinator.onRequest(listener);
    const pending = coordinator.request({ source: 'agent', surface: 'composer', sessionId: 'session-a', taskId: 'task-a', toolName: 'filesystem.write', detail: {} });
    const request = listener.mock.calls[0]?.[0];
    await expect(coordinator.respond(request!.approvalId, true, { sessionId: 'session-b', taskId: 'task-b' })).rejects.toThrow('different session');
    await expect(coordinator.respond(request!.approvalId, false, { sessionId: 'session-a', taskId: 'task-a' })).resolves.toMatchObject({ approved: false });
    await expect(pending).resolves.toMatchObject({ approved: false });
  });

  it('resolves as denied without calling the action when its process is unavailable', async () => {
    const coordinator = new ApprovalCoordinator();
    const listener = vi.fn();
    const onDecision = vi.fn().mockResolvedValue(undefined);
    coordinator.onRequest(listener);
    const pending = coordinator.request({ source: 'agent', surface: 'composer', toolName: 'filesystem.write', detail: { summary: 'Write.' } }, onDecision, { isAvailable: () => false });
    const request = listener.mock.calls[0]?.[0];

    await expect(coordinator.respond(request!.approvalId, true)).resolves.toMatchObject({ approvalId: request!.approvalId, approved: false });
    await expect(pending).resolves.toMatchObject({ approvalId: request!.approvalId, approved: false });
    expect(onDecision).not.toHaveBeenCalled();
  });

  it('cancels on timeout without calling the action when the process disappears', async () => {
    vi.useFakeTimers();
    try {
      const coordinator = new ApprovalCoordinator();
      const onDecision = vi.fn().mockResolvedValue(undefined);
      const pending = coordinator.request({ source: 'agent', surface: 'composer', toolName: 'filesystem.write', detail: { summary: 'Write.' }, timeoutMs: 10_000 }, onDecision, { isAvailable: () => false });

      await vi.advanceTimersByTimeAsync(10_000);
      await expect(pending).resolves.toMatchObject({ approved: false });
      expect(onDecision).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('cancels a turn approval without calling back into an already-aborted agent', async () => {
    const coordinator = new ApprovalCoordinator();
    const onDecision = vi.fn().mockResolvedValue(undefined);
    const pending = coordinator.request({ source: 'agent', surface: 'composer', turnId: 'turn-1', toolName: 'filesystem.write', detail: { summary: 'Write.' } }, onDecision);

    await coordinator.cancelWhere(request => request.turnId === 'turn-1', { notifyDecision: false });

    await expect(pending).resolves.toMatchObject({ approvalId: expect.any(String), approved: false });
    expect(onDecision).not.toHaveBeenCalled();
    expect(coordinator.listPending()).toEqual([]);
  });

  it('expires an owner-scoped approval without requiring an owner from the timer', async () => {
    vi.useFakeTimers();
    try {
      const coordinator = new ApprovalCoordinator();
      const pending = coordinator.request({ source: 'agent', surface: 'composer', sessionId: 'session-a', taskId: 'task-a', toolName: 'filesystem.write', detail: {}, timeoutMs: 10_000 });

      await vi.advanceTimersByTimeAsync(10_000);

      await expect(pending).resolves.toMatchObject({ approved: false });
      expect(coordinator.listPending()).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });
});
