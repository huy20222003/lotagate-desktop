import type { SubagentSnapshot } from '../../../../contracts/ipc/v1/workspace.js';

export type ActiveSubagentActivity = { state: 'queued' | 'created'; label: string };

export function activeSubagents(subagents: readonly SubagentSnapshot[]): SubagentSnapshot[] {
  return subagents.filter(subagent => subagent.status === 'queued' || subagent.status === 'running');
}

export function activeSubagentActivity(subagents: readonly SubagentSnapshot[]): ActiveSubagentActivity | undefined {
  const active = activeSubagents(subagents);
  if (active.length === 0) return undefined;
  if (active.some(subagent => subagent.status === 'queued')) return { state: 'queued', label: 'Create agent' };
  return { state: 'created', label: `Created agent ${active.map(subagent => subagent.displayName).join(', ')}` };
}
