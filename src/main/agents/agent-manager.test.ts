import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AgentManager } from './agent-manager.js';
import type { DesktopEvent } from '../../contracts/agent-protocol/v1/desktop.js';

describe('AgentManager response routing', () => {
  it('releases approval and trust routes after the CLI response settles', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lotagate-agent-manager-'));
    try {
      const canonicalRoot = await realpath(root);
      const manager = new AgentManager({ onEvent: () => undefined });
      const binding = { projectRoot: canonicalRoot, process: { initialize: async () => undefined, request: async () => ({ accepted: true }), shutdown: async () => undefined, isAvailable: () => true } };
      const internals = manager as unknown as { approvalBindings: Map<string, unknown>; trustBindings: Map<string, unknown>; };
      internals.approvalBindings.set('approval-1', binding);
      internals.trustBindings.set('trust-1', binding);

      await manager.approvalRespond(canonicalRoot, { approvalId: 'approval-1', decision: 'allow' });
      await manager.trustRespond(canonicalRoot, { trustRequestId: 'trust-1', trusted: true });

      expect(internals.approvalBindings.has('approval-1')).toBe(false);
      expect(internals.trustBindings.has('trust-1')).toBe(false);
      await manager.shutdownAll();
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('removes all routes for a CLI binding after an unexpected process exit', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lotagate-agent-manager-'));
    try {
      const canonicalRoot = await realpath(root);
      const manager = new AgentManager({ onEvent: () => undefined });
      const binding = { key: 'session:session-1', projectRoot: canonicalRoot, sessionId: 'session-1', process: { initialize: async () => undefined, request: async () => ({}), shutdown: async () => undefined, isAvailable: () => false } };
      const internals = manager as unknown as { processes: Map<string, unknown>; sessionBindings: Map<string, unknown>; turnBindings: Map<string, unknown>; approvalBindings: Map<string, unknown>; trustBindings: Map<string, unknown>; removeBinding(value: unknown): void };
      internals.processes.set(binding.key, binding);
      internals.sessionBindings.set(binding.sessionId, binding);
      internals.turnBindings.set('turn-1', binding);
      internals.approvalBindings.set('approval-1', binding);
      internals.trustBindings.set('trust-1', binding);

      internals.removeBinding(binding);

      expect(internals.processes.has(binding.key)).toBe(false);
      expect(internals.sessionBindings.has(binding.sessionId)).toBe(false);
      expect(internals.turnBindings.size).toBe(0);
      expect(internals.approvalBindings.size).toBe(0);
      expect(internals.trustBindings.size).toBe(0);
      await manager.shutdownAll();
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('marks command results truncated when the bounded event buffer drops output', async () => {
    const manager = new AgentManager({ onEvent: () => undefined });
    const internals = manager as unknown as { recordCommandEvent(event: DesktopEvent): void; commandEventBuffers: Map<string, { truncated: boolean; events: DesktopEvent[]; bytes: number; timer: ReturnType<typeof setTimeout> }>; readCommandExecutionResult(commandId: string, buffer: unknown, events: DesktopEvent[]): { content: string; truncated: boolean } };
    const largeOutput: DesktopEvent = { version: 1, type: 'event', scope: 'control', event: 'command.output', data: { commandId: 'command-1', content: 'x'.repeat(300_000) } };
    const completed: DesktopEvent = { version: 1, type: 'event', scope: 'control', event: 'command.completed', data: { commandId: 'command-1', exitCode: 0 } };

    internals.recordCommandEvent(largeOutput);
    internals.recordCommandEvent(completed);
    const buffer = internals.commandEventBuffers.get('command-1');
    expect(buffer).toBeDefined();
    expect(buffer?.truncated).toBe(true);
    expect(internals.readCommandExecutionResult('command-1', buffer, buffer?.events ?? [])).toMatchObject({ content: '', truncated: true });
    await manager.shutdownAll();
  });
});
