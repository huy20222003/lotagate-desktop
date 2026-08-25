import type { PlanSnapshot, SubagentSnapshot } from '../../../contracts/ipc/v1/workspace.js';

export function applySubagentEvent(current: SubagentSnapshot[], event: string, data: Record<string, unknown>): SubagentSnapshot[] {
  if (!event.startsWith('subagent.')) return current;
  const id = readString(data['id']);
  if (id === undefined) return current;
  const previous = current.find(item => item.id === id);
  const durationMs = readNumber(data['durationMs']) ?? previous?.durationMs;
  const summary = readString(data['summary']) ?? previous?.summary;
  const lastAction = parseLastAction(data['lastAction']) ?? previous?.lastAction;
  const handoff = parseHandoff(data['handoff']) ?? previous?.handoff;
  const next: SubagentSnapshot = {
    id,
    displayName: readString(data['displayName']) ?? previous?.displayName ?? id,
    task: readString(data['task']) ?? previous?.task ?? '',
    mode: data['mode'] === 'worker' ? 'worker' : previous?.mode ?? 'research',
    model: readString(data['model']) ?? previous?.model ?? '',
    status: readStatus(data['status']) ?? previous?.status ?? 'queued',
    background: typeof data['background'] === 'boolean' ? data['background'] : previous?.background ?? false,
    timestamp: readNumber(data['timestamp']) ?? previous?.timestamp ?? Date.now(),
    ...(durationMs === undefined ? {} : { durationMs }),
    ...(summary === undefined ? {} : { summary }),
    ...(lastAction === undefined ? {} : { lastAction }),
    ...(handoff === undefined ? {} : { handoff }),
  };
  return previous === undefined ? [...current, next] : current.map(item => item.id === id ? next : item);
}

export function applyPlanEvent(current: PlanSnapshot | undefined, event: string, data: Record<string, unknown>): PlanSnapshot | undefined {
  if (!event.startsWith('plan.')) return current;
  const id = readString(data['planId']) ?? current?.id;
  if (id === undefined) return current;
  if (event === 'plan.started') {
    const steps = Array.isArray(data['steps']) ? data['steps'].flatMap((value, index) => parseStep(value, index)) : [];
    return { id, goal: readString(data['goal']) ?? '', totalSteps: readNumber(data['totalSteps']) ?? steps.length, steps, status: 'started', ...(steps.length > 0 ? { currentStep: 0 } : {}) };
  }
  if (current === undefined) return undefined;
  if (event === 'plan.completed') { const completed = { ...current }; delete completed.currentStep; return { ...completed, status: 'completed', steps: current.steps.map(step => ({ ...step, status: 'completed' })) }; }
  if (event === 'plan.failed') return { ...current, status: 'failed', error: readString(data['error']) ?? 'Plan failed.' };
  const index = readNumber(data['index']);
  if (index === undefined || current.steps[index] === undefined) return current;
  const status = event === 'plan.step.completed' ? 'completed' : event === 'plan.step.started' ? 'started' : undefined;
  if (status === undefined) return current;
  return { ...current, steps: current.steps.map((step, stepIndex) => stepIndex === index ? { ...step, status } : step), ...(status === 'started' ? { currentStep: index } : {}) };
}

function parseStep(value: unknown, fallbackIndex: number): PlanSnapshot['steps'][number][] {
  if (typeof value !== 'object' || value === null) return [];
  const record = value as Record<string, unknown>;
  const id = readString(record['id']);
  const title = readString(record['title']);
  if (id === undefined || title === undefined) return [];
  return [{ index: readNumber(record['index']) ?? fallbackIndex, id, title, description: readString(record['description']) ?? '', status: record['status'] === 'completed' ? 'completed' : record['status'] === 'running' ? 'started' : 'queued' }];
}

function parseLastAction(value: unknown): SubagentSnapshot['lastAction'] | undefined { if (typeof value !== 'object' || value === null) return undefined; const record = value as Record<string, unknown>; const label = readString(record['label']); return label === undefined ? undefined : { kind: readString(record['kind']) ?? 'other', label }; }
function parseHandoff(value: unknown): SubagentSnapshot['handoff'] | undefined { if (typeof value !== 'object' || value === null) return undefined; const record = value as Record<string, unknown>; const summary = readString(record['summary']); if (summary === undefined) return undefined; return { summary, filesInspected: readStrings(record['filesInspected']), filesChanged: readStrings(record['filesChanged']), commandsRun: readStrings(record['commandsRun']), verification: readStrings(record['verification']), warnings: readStrings(record['warnings']) }; }
function readStatus(value: unknown): SubagentSnapshot['status'] | undefined { return value === 'queued' || value === 'running' || value === 'completed' || value === 'completed_with_warning' || value === 'failed' || value === 'cancelled' ? value : undefined; }
function readString(value: unknown): string | undefined { return typeof value === 'string' && value.trim() ? value : undefined; }
function readNumber(value: unknown): number | undefined { return typeof value === 'number' && Number.isFinite(value) ? value : undefined; }
function readStrings(value: unknown): string[] { return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string').slice(0, 100) : []; }
