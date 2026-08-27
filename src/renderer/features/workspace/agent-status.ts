import { readString } from '../../utils/data.js';

export function agentStatusForEvent(event: string, data: Record<string, unknown>): string | undefined {
  if (event === 'approval.requested') {
    const displayName = readString(data['displayName']) ?? readString(data['toolName']) ?? 'this action';
    return `I need your approval before I continue with ${displayName}.`;
  }
  if (event === 'tool.started') {
    const displayName = readString(data['displayName']) ?? readString(data['toolName']) ?? 'the next step';
    const kind = readString(data['kind']);
    if (kind === 'filesystem') return `I’ll inspect the workspace with ${displayName}.`;
    if (kind === 'shell') return `I’ll run ${displayName} to verify the next step.`;
    if (kind === 'mcp') return `I’ll query ${displayName} for the information needed next.`;
    if (kind === 'subagent') return `I’ll delegate ${displayName} as an independent step.`;
    return `I’ll use ${displayName} to continue.`;
  }
  if (event !== 'command.activity.started') return undefined;
  return readString(data['label']) ?? readString(data['message']) ?? readString(data['status']) ?? 'I’m working through the next step.';
}
