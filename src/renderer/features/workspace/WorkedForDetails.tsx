import type { Activity } from '../../../contracts/ipc/v1/workspace.js';
import { AgentMarkdown } from './markdown-renderer.js';
import { isAssistantProgressActivity } from './conversation-activities.js';

interface ToolStep {
  actionId: string;
  displayName: string;
  state: 'running' | 'completed' | 'failed';
}

export function WorkedForDetails({ statusText, progressActivities, toolActivities }: { statusText?: string | undefined; progressActivities: readonly Activity[]; toolActivities: readonly Activity[] }) {
  const toolSteps = groupToolActivities(toolActivities).filter(step => step.state !== 'completed');
  if (statusText === undefined && progressActivities.length === 0 && toolSteps.length === 0) return null;
  return <div className="worked-details">
    {statusText ? <div className="worked-status">{statusText}</div> : null}
    {progressActivities.filter(isAssistantProgressActivity).map(activity => <div className="worked-progress" key={activity.id}><AgentMarkdown content={activity.text} /></div>)}
    {toolSteps.map(step => <div className={`worked-tool worked-tool-${step.state}`} key={step.actionId}><span className={step.state === 'running' ? 'typing-label' : undefined}>{toolLabel(step)}</span></div>)}
  </div>;
}

function groupToolActivities(activities: readonly Activity[]): ToolStep[] {
  const steps = new Map<string, ToolStep>();
  for (const activity of activities) {
    const actionId = readString(activity.metadata['actionId']) ?? activity.id;
    const previous = steps.get(actionId);
    const failed = activity.metadata['isError'] === true || activity.metadata['status'] === 'failed' || activity.text.endsWith(' failed.');
    const completed = activity.metadata['status'] === 'completed' || activity.metadata['status'] === 'failed' || activity.text.endsWith(' completed.') || failed;
    const state = failed ? 'failed' : completed ? 'completed' : previous?.state ?? 'running';
    const fallbackName = activity.text.replace(/^Running /u, '').replace(/ (?:completed|failed)\.$/u, '').trim();
    const displayName = readString(activity.metadata['displayName']) ?? readString(activity.metadata['toolName']) ?? fallbackName;
    steps.set(actionId, { actionId, displayName, state });
  }
  return [...steps.values()];
}

function toolLabel(step: ToolStep): string {
  const actionName = normalizeActionName(step.displayName);
  if (step.state === 'running') return `Run ${actionName}`;
  if (step.state === 'failed') return `Failed ${actionName}`;
  return `Ran ${actionName}`;
}

function normalizeActionName(value: string): string {
  const withoutRunPrefix = value.replace(/^Run\s+/u, '').trim();
  return withoutRunPrefix.length === 0 ? value : withoutRunPrefix;
}

function readString(value: unknown): string | undefined { return typeof value === 'string' && value.length > 0 ? value : undefined; }
