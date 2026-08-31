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
});
