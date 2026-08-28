import { readString } from '../../utils/data.js';
import { formatToolDisplayName } from '../../../shared/tool-display.js';

export function agentStatusForEvent(event: string, data: Record<string, unknown>): string | undefined {
  if (event === 'approval.requested') {
    const displayName = formatToolDisplayName(data['toolName'], data['displayName']);
    return `I need your approval before I continue with ${displayName}.`;
  }
  if (event === 'tool.started') {
    const displayName = formatToolDisplayName(data['toolName'], data['displayName']);
    const kind = readString(data['kind']);
    if (kind === 'filesystem') return `I’ll inspect the workspace with ${displayName}.`;
    if (kind === 'shell') return `I’ll run ${displayName} to verify the next step.`;
    if (kind === 'mcp') return `I’ll query ${displayName} for the information needed next.`;
    if (kind === 'subagent') return `I’ll delegate ${displayName} as an independent step.`;
    return `I’ll use ${displayName} to continue.`;
  }
  if (event === 'tool.completed') {
    const displayName = formatToolDisplayName(data['toolName'], data['displayName']);
    return `${displayName} · ${data['isError'] === true ? 'failed' : 'completed'}`;
  }
  if (event === 'command.started') return 'Running command…';
  if (event === 'command.completed') return data['success'] === false ? 'Command failed.' : 'Command completed.';
  if (event === 'command.failed') return 'Command failed.';
  if (event === 'command.cancelled') return 'Command cancelled.';
  if (event === 'command.activity.completed') return data['isError'] === true ? 'Command step failed.' : 'Command step completed.';
  if (event !== 'command.activity.started') return undefined;
  return readString(data['label']) ?? readString(data['message']) ?? readString(data['status']) ?? 'I’m working through the next step.';
}
