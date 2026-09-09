import type { Activity } from '../../../../contracts/ipc/v1/workspace.js';
import { Bot, ChevronRight, Terminal } from 'lucide-react';
import type { SubagentSnapshot } from '../../../../contracts/ipc/v1/workspace.js';
import { formatToolDisplayName } from '../../../../shared/tool-display.js';
import { activeSubagentActivity } from '../orchestration/subagent-display.js';
import { AgentMarkdown } from './markdown-renderer.js';
import { isAssistantProgressActivity } from './conversation-activities.js';
import { useSmoothStreamingText } from './use-smooth-streaming-text.js';
import { contextCompactionPhase, isContextCompactionActivity } from './context-compaction-activity.js';

interface ToolStep {
  actionId: string;
  displayName: string;
  command?: string;
  additions?: number;
  deletions?: number;
  detailed: boolean;
  state: 'running' | 'completed' | 'failed';
}

export interface WorkedForDetailsProps {
  active?: boolean;
  statusText?: string | undefined;
  activities: readonly Activity[];
  subagents?: readonly SubagentSnapshot[];
}

type WorkedItem =
  | { kind: 'progress'; activity: Activity }
  | { kind: 'context'; activity: Activity }
  | { kind: 'tool'; step: ToolStep };

type RenderedWorkedItem =
  | { kind: 'progress'; activity: Activity }
  | { kind: 'context'; activity: Activity }
  | { kind: 'tools'; steps: ToolStep[] };

export function hasWorkedForDetails({ statusText, activities, subagents = [] }: WorkedForDetailsProps): boolean {
  return statusText !== undefined || buildWorkedItems(activities).length > 0 || activeSubagentActivity(subagents) !== undefined;
}

export function hasRunningWorkedTool(activities: readonly Activity[]): boolean {
  return buildWorkedItems(activities).some(item => item.kind === 'tool' && item.step.state === 'running');
}

export function WorkedForDetails({ active = false, statusText, activities, subagents = [] }: WorkedForDetailsProps) {
  const items = buildWorkedItems(activities);
  const subagentActivity = activeSubagentActivity(subagents);
  if (!hasWorkedForDetails({ statusText, activities, subagents })) return null;
  const renderedItems = groupToolItems(items);
  return <div className="worked-details">
    {subagentActivity ? <div className={`worked-subagent worked-subagent-${subagentActivity.state}`}><Bot className="worked-subagent-icon" size={14} aria-hidden="true" /><span>{subagentActivity.label}</span></div> : null}
    {statusText ? <WorkedText className="worked-status" content={statusText} active={active} /> : null}
    {renderedItems.map((item, index) => item.kind === 'progress'
      ? <WorkedProgress key={item.activity.id} content={item.activity.text} active={active} />
      : item.kind === 'context'
        ? <WorkedCompaction key={item.activity.id} activity={item.activity} />
      : item.steps.length === 1
        ? <WorkedTool key={item.steps[0]!.actionId} step={item.steps[0]!} />
        : <WorkedToolGroup key={`tool-group:${item.steps[0]?.actionId ?? index}`} steps={item.steps} />)}
  </div>;
}

function WorkedCompaction({ activity }: { activity: Activity }) {
  const phase = contextCompactionPhase(activity);
  if (phase === undefined) return null;
  const compacting = phase === 'compacting';
  return <div className={`worked-tool worked-tool-${compacting ? 'running' : 'completed'}`} aria-live="polite"><WorkedToolIcon /><span className={compacting ? 'typing-label' : undefined}>{compacting ? 'Context automatically compacting' : 'Context automatically compacted'}</span></div>;
}

function WorkedTool({ step }: { step: ToolStep }) {
  return <div className={`worked-tool worked-tool-${step.state}`}><WorkedToolIcon /><span className={step.state === 'running' ? 'typing-label' : undefined} title={step.command ?? step.displayName}>{toolLabel(step)}</span></div>;
}

function WorkedToolGroup({ steps }: { steps: ToolStep[] }) {
  const runningStep = [...steps].reverse().find(step => step.state === 'running');
  const failedStep = [...steps].reverse().find(step => step.state === 'failed');
  const summary = runningStep === undefined
    ? failedStep === undefined
      ? steps.length === 1 ? toolLabel(steps[0]!) : 'Ran commands'
      : steps.length === 1 ? toolLabel(failedStep) : 'Failed commands'
    : toolLabel(runningStep);
  return <details className="worked-tool-group">
    <summary><span className={`worked-tool-group-label${runningStep === undefined ? '' : ' is-running'}`}><WorkedToolIcon />{summary}</span><span className="worked-tool-group-chevron" aria-hidden="true"><ChevronRight size={13} /></span></summary>
    <div className="worked-tool-group-items">{steps.map(step => <WorkedTool key={step.actionId} step={step} />)}</div>
  </details>;
}

function WorkedToolIcon() { return <Terminal className="worked-tool-icon worked-tool-terminal-icon" size={14} aria-hidden="true" />; }

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
    if (isContextCompactionActivity(activity)) {
      items.push({ kind: 'context', activity });
      continue;
    }
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
      if (existing?.kind === 'tool') items[existingIndex] = { kind: 'tool', step: mergeToolSteps(existing.step, step) };
    }
  }
  return items;
}

function groupToolItems(items: readonly WorkedItem[]): RenderedWorkedItem[] {
  const grouped: RenderedWorkedItem[] = [];
  for (const item of items) {
    if (item.kind === 'progress') {
      grouped.push(item);
      continue;
    }
    if (item.kind === 'context') {
      grouped.push(item);
      continue;
    }
    const previous = grouped[grouped.length - 1];
    if (previous?.kind === 'tools') previous.steps.push(item.step);
    else grouped.push({ kind: 'tools', steps: [item.step] });
  }
  return grouped;
}

function toolStepForActivity(activity: Activity, previousStep: ToolStep | undefined): ToolStep {
  const actionId = readString(activity.metadata['actionId']) ?? activity.id;
  const failed = activity.metadata['isError'] === true || activity.metadata['status'] === 'failed' || activity.text.endsWith(' failed.');
  const completed = activity.metadata['status'] === 'completed' || activity.metadata['status'] === 'failed' || activity.text.endsWith(' completed.') || failed;
  const state = failed ? 'failed' : completed ? 'completed' : previousStep?.state ?? 'running';
  const fallbackName = activity.text.replace(/^Running /u, '').replace(/ (?:completed|failed)\.$/u, '').trim();
  const command = readString(activity.metadata['command']) ?? previousStep?.command;
  const displayName = command ?? formatToolDisplayName(readString(activity.metadata['toolName']) ?? fallbackName, readString(activity.metadata['displayName']));
  const fileChange = readFileChange(activity.metadata['fileChange']);
  return { actionId, displayName, ...(command === undefined ? {} : { command }), ...(fileChange === undefined ? {} : { additions: fileChange.additions, deletions: fileChange.deletions }), detailed: isDetailedToolActivity(activity), state };
}

function mergeToolSteps(previous: ToolStep, current: ToolStep): ToolStep {
  if (!previous.detailed || current.detailed) return current;
  return {
    ...current,
    displayName: previous.displayName,
    detailed: true,
    ...(previous.command === undefined ? {} : { command: previous.command }),
    ...(previous.additions === undefined ? {} : { additions: previous.additions }),
    ...(previous.deletions === undefined ? {} : { deletions: previous.deletions }),
  };
}

function toolLabel(step: ToolStep): string {
  const actionName = step.command === undefined
    ? normalizeActionName(step.displayName)
    : normalizeActionName(step.command);
  if (step.state === 'running') return `Run ${actionName}`;
  if (step.state === 'failed') return `Failed ${actionName}`;
  const counts = step.additions === undefined || step.deletions === undefined ? '' : ` +${step.additions} -${step.deletions}`;
  return `Ran ${actionName}${counts}`;
}

function normalizeActionName(value: string): string {
  const withoutRunPrefix = value.replace(/^Run\s+/u, '').trim();
  return withoutRunPrefix.length === 0 ? value : withoutRunPrefix;
}

function readString(value: unknown): string | undefined { return typeof value === 'string' && value.length > 0 ? value : undefined; }
function isDetailedToolActivity(activity: Activity): boolean {
  const toolName = readString(activity.metadata['toolName']);
  if (toolName !== 'shell.exec' && toolName !== 'filesystem.read' && toolName !== 'filesystem.write' && toolName !== 'filesystem.exists') return false;
  const displayName = readString(activity.metadata['displayName']);
  return readString(activity.metadata['command']) !== undefined || activity.metadata['fileChange'] !== undefined || (displayName !== undefined && displayName !== toolName);
}
function readFileChange(value: unknown): { additions: number; deletions: number } | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const additions = (value as Record<string, unknown>)['additions'];
  const deletions = (value as Record<string, unknown>)['deletions'];
  return typeof additions === 'number' && Number.isInteger(additions) && additions >= 0 && typeof deletions === 'number' && Number.isInteger(deletions) && deletions >= 0 ? { additions, deletions } : undefined;
}
