import type { Activity } from '../../contracts/ipc/v1/workspace.js';

const AUTOMATION_SUMMARY_MAX_LENGTH = 8_192;

export function finalAutomationSummary(activities: readonly Activity[]): string | undefined {
  for (let index = activities.length - 1; index >= 0; index -= 1) {
    const activity = activities[index];
    if (activity?.kind !== 'assistant' || activity.metadata['assistantPhase'] !== 'final') continue;
    const summary = activity.text.trim();
    if (summary.length === 0) continue;
    return summary.slice(0, AUTOMATION_SUMMARY_MAX_LENGTH);
  }
  return undefined;
}
