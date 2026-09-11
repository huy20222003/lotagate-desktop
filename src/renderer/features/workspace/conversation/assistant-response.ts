import type { Activity } from '../../../../contracts/ipc/v1/workspace.js';

export interface AssistantFinalResponse {
  turnId: string;
  text: string;
}

export function finalAssistantResponseForTurn(activities: readonly Activity[], taskId: string, turnId: string): AssistantFinalResponse | undefined {
  const text = activities
    .filter(activity => activity.taskId === taskId && activity.kind === 'assistant' && activity.metadata['turnId'] === turnId && activity.metadata['assistantPhase'] === 'final')
    .map(activity => activity.text.trim())
    .filter(Boolean)
    .join('\n\n')
    .trim();
  return text.length === 0 ? undefined : { turnId, text };
}
