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
});
