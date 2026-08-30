import type { Activity } from '../../../contracts/ipc/v1/workspace.js';
import { formatToolDisplayName } from '../../../shared/tool-display.js';
import { AgentMarkdown } from './markdown-renderer.js';
import { isAssistantProgressActivity } from './conversation-activities.js';
import { useSmoothStreamingText } from './use-smooth-streaming-text.js';

interface ToolStep {
  actionId: string;
  displayName: string;
  state: 'running' | 'completed' | 'failed';
}

export function WorkedForDetails({ active = false, statusText, progressActivities, toolActivities }: { active?: boolean; statusText?: string | undefined; progressActivities: readonly Activity[]; toolActivities: readonly Activity[] }) {
  const toolSteps = groupToolActivities(toolActivities);
  if (statusText === undefined && progressActivities.length === 0 && toolSteps.length === 0) return null;
  return <div className="worked-details">
    {statusText ? <WorkedText className="worked-status" content={statusText} active={active} /> : null}
    {progressActivities.filter(isAssistantProgressActivity).map(activity => <WorkedProgress key={activity.id} content={activity.text} active={active} />)}
    {toolSteps.map(step => <div className={`worked-tool worked-tool-${step.state}`} key={step.actionId}><span className={step.state === 'running' ? 'typing-label' : undefined}>{toolLabel(step)}</span></div>)}
  </div>;
}

function WorkedProgress({ content, active }: { content: string; active: boolean }) {
  return <div className="worked-progress"><WorkedText content={content} active={active} markdown /></div>;
}

function WorkedText({ className, content, active, markdown = false }: { className?: string; content: string; active: boolean; markdown?: boolean }) {
  const displayedText = useSmoothStreamingText(content, active);
  return <div className={className}>{markdown ? <AgentMarkdown content={displayedText} /> : displayedText}</div>;
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
    const displayName = formatToolDisplayName(readString(activity.metadata['toolName']) ?? fallbackName, readString(activity.metadata['displayName']));
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
