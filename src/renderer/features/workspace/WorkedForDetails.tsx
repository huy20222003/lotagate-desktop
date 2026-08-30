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

export interface WorkedForDetailsProps {
  active?: boolean;
  statusText?: string | undefined;
  activities: readonly Activity[];
}

type WorkedItem =
  | { kind: 'progress'; activity: Activity }
  | { kind: 'tool'; step: ToolStep };

export function hasWorkedForDetails({ statusText, activities }: WorkedForDetailsProps): boolean {
  return statusText !== undefined || buildWorkedItems(activities).length > 0;
}

export function WorkedForDetails({ active = false, statusText, activities }: WorkedForDetailsProps) {
  const items = buildWorkedItems(activities);
  if (!hasWorkedForDetails({ statusText, activities })) return null;
  return <div className="worked-details">
    {statusText ? <WorkedText className="worked-status" content={statusText} active={active} /> : null}
    {items.map(item => item.kind === 'progress' ? <WorkedProgress key={item.activity.id} content={item.activity.text} active={active} /> : <div className={`worked-tool worked-tool-${item.step.state}`} key={item.step.actionId}><span className={item.step.state === 'running' ? 'typing-label' : undefined}>{toolLabel(item.step)}</span></div>)}
  </div>;
}

function WorkedProgress({ content, active }: { content: string; active: boolean }) {
  return <div className="worked-progress"><WorkedText content={content} active={active} markdown /></div>;
}

function WorkedText({ className, content, active, markdown = false }: { className?: string; content: string; active: boolean; markdown?: boolean }) {
  const displayedText = useSmoothStreamingText(content, active);
  return <div className={className}>{markdown ? <AgentMarkdown content={displayedText} /> : displayedText}</div>;
}

function buildWorkedItems(activities: readonly Activity[]): WorkedItem[] {
  const items: WorkedItem[] = [];
  const toolItemIndexes = new Map<string, number>();
  for (const activity of activities) {
    if (isAssistantProgressActivity(activity)) {
      items.push({ kind: 'progress', activity });
      continue;
    }
    if (activity.kind !== 'tool') continue;
    const actionId = readString(activity.metadata['actionId']) ?? activity.id;
    const existingIndex = toolItemIndexes.get(actionId);
    const existing = existingIndex === undefined ? undefined : items[existingIndex];
    const step = toolStepForActivity(activity, existing?.kind === 'tool' ? existing.step : undefined);
    if (existingIndex === undefined) {
      toolItemIndexes.set(step.actionId, items.length);
      items.push({ kind: 'tool', step });
    } else {
      const existing = items[existingIndex];
      if (existing?.kind === 'tool') items[existingIndex] = { kind: 'tool', step };
    }
  }
  return items;
}

function toolStepForActivity(activity: Activity, previousStep: ToolStep | undefined): ToolStep {
  const actionId = readString(activity.metadata['actionId']) ?? activity.id;
  const failed = activity.metadata['isError'] === true || activity.metadata['status'] === 'failed' || activity.text.endsWith(' failed.');
  const completed = activity.metadata['status'] === 'completed' || activity.metadata['status'] === 'failed' || activity.text.endsWith(' completed.') || failed;
  const state = failed ? 'failed' : completed ? 'completed' : previousStep?.state ?? 'running';
  const fallbackName = activity.text.replace(/^Running /u, '').replace(/ (?:completed|failed)\.$/u, '').trim();
  const displayName = formatToolDisplayName(readString(activity.metadata['toolName']) ?? fallbackName, readString(activity.metadata['displayName']));
  return { actionId, displayName, state };
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
