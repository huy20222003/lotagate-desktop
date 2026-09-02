import { describe, expect, it } from 'vitest';
import { remoteCommandSchema, remoteEnvelopeSchema, remoteTaskSummary, remoteWorkspaceSummary } from './remote-control.js';

describe('Remote Control contract', () => {
  it('accepts only supported command shapes', () => {
    expect(remoteCommandSchema.parse({ action: 'prompt', taskId: 'task-1', prompt: 'Continue.' })).toMatchObject({ action: 'prompt' });
    expect(() => remoteCommandSchema.parse({ action: 'prompt', taskId: 'task-1', prompt: '' })).toThrow();
    expect(() => remoteCommandSchema.parse({ action: 'unknown' })).toThrow();
  });

  it('requires a monotonic transport envelope shape', () => {
    expect(remoteEnvelopeSchema.parse({ version: 1, type: 'encrypted', messageId: 'message-1', sequence: 0, sentAt: '2026-09-02T00:00:00.000Z', nonce: 'nonce', ciphertext: 'ciphertext' })).toMatchObject({ version: 1, sequence: 0 });
    expect(() => remoteEnvelopeSchema.parse({ version: 2, type: 'encrypted', messageId: 'message-1', sequence: 0, sentAt: '2026-09-02T00:00:00.000Z', nonce: 'nonce', ciphertext: 'ciphertext' })).toThrow();
  });

  it('maps task and workspace data to the remote-safe summary shape', () => {
    const task = { id: 'task-1', workspaceId: 'workspace-1', title: 'Fix the build', cwd: 'C:\\workspace', status: 'active', sessionId: 'session-1', lastEventCursor: 0, pinned: false, archived: false, draft: '', draftAttachmentIds: [], createdAt: '2026-09-02T00:00:00.000Z', updatedAt: '2026-09-02T00:00:00.000Z' } as Parameters<typeof remoteTaskSummary>[0];
    const workspace = { id: 'workspace-1', name: 'Desktop', rootPath: 'C:\\workspace' } as Parameters<typeof remoteWorkspaceSummary>[0];

    expect(remoteTaskSummary(task)).toEqual({ id: 'task-1', title: 'Fix the build', status: 'active', sessionId: 'session-1', updatedAt: '2026-09-02T00:00:00.000Z' });
    expect(remoteWorkspaceSummary(workspace, [task])).toMatchObject({ id: 'workspace-1', name: 'Desktop', tasks: [{ id: 'task-1' }] });
  });
});
