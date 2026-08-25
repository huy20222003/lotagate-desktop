import { describe, expect, it, vi } from 'vitest';
import type { TaskStore } from '../tasks/task-store.js';
import type { WorkspaceRegistry } from '../workspaces/workspace-registry.js';
import { TerminalService, type TerminalEvidence } from './terminal-service.js';

vi.mock('electron', () => ({ app: { getPath: () => process.cwd() } }));

const taskStore = { require: vi.fn(async () => ({ workspaceId: 'workspace-1' })) } as unknown as TaskStore;
const workspaceRegistry = { require: vi.fn(async () => ({ id: 'workspace-1', rootPath: process.cwd(), trusted: true })) } as unknown as WorkspaceRegistry;

function createEvidenceStore() {
  let values: TerminalEvidence[] = [];
  return { read: async () => values, write: async (next: TerminalEvidence[]) => { values = next; } };
}

describe('TerminalService', () => {
  it('rejects malformed execution input at runtime', async () => {
    const service = new TerminalService(workspaceRegistry, taskStore, createEvidenceStore());
    await expect(service.execute({ cwd: process.cwd(), command: process.execPath, args: 'not-an-array' as unknown as string[], taskId: 'task-1', approved: true })).rejects.toThrow();
  });

  it('rejects unapproved mutating commands before spawning', async () => {
    const service = new TerminalService(workspaceRegistry, taskStore, createEvidenceStore());
    await expect(service.execute({ cwd: process.cwd(), command: process.execPath, args: ['-e', ''], taskId: 'task-1', approved: false })).rejects.toThrow('explicit approval');
  });

  it('requires a trusted workspace and keeps cwd inside it', async () => {
    const untrustedRegistry = { require: vi.fn(async () => ({ id: 'workspace-1', rootPath: process.cwd(), trusted: false })) } as unknown as WorkspaceRegistry;
    const service = new TerminalService(untrustedRegistry, taskStore, createEvidenceStore());
    await expect(service.execute({ cwd: process.cwd(), command: process.execPath, args: ['-e', ''], taskId: 'task-1', approved: true })).rejects.toThrow('trusted workspace');

    const trustedService = new TerminalService(workspaceRegistry, taskStore, createEvidenceStore());
    await expect(trustedService.execute({ cwd: process.env['TEMP'] ?? process.cwd(), command: process.execPath, args: ['-e', ''], taskId: 'task-1', approved: true })).rejects.toThrow('outside the workspace boundary');
  });

  it('executes an explicitly approved command for a trusted workspace', async () => {
    const service = new TerminalService(workspaceRegistry, taskStore, createEvidenceStore());
    const result = await service.execute({ cwd: process.cwd(), command: process.execPath, args: ['-e', 'process.stdout.write("ok")'], taskId: 'task-1', approved: true });
    expect(result.stdout).toBe('ok');
    expect(result.taskId).toBe('task-1');
  });
});
