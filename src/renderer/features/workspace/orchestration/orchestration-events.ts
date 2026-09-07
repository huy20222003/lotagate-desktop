import type { SubagentSnapshot, WorkEvidenceSnapshot, WorkPlanSnapshot, WorkPlanStepSnapshot } from '../../../../contracts/ipc/v1/workspace.js';
import { readNumber, readString } from '../../../utils/data.js';

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

/** Applies only the structured work-plan stream. Turn and version checks make late events harmless. */
export function applyWorkPlanEvent(current: WorkPlanSnapshot | undefined, event: string, data: Record<string, unknown>): WorkPlanSnapshot | undefined {
  if (!event.startsWith('work.')) return current;
  const turnId = readString(data['turnId']);
  const id = readString(data['planId']);
  const version = readNumber(data['version']);
  if (turnId === undefined || id === undefined || version === undefined) return current;
  const isPlanSnapshotEvent = event === 'work.plan.created' || event === 'work.plan.updated';
  if (current !== undefined && current.turnId !== turnId && !isPlanSnapshotEvent) return current;
  if (current !== undefined && current.turnId === turnId && version <= current.version) return current;
  if (isPlanSnapshotEvent) {
    const steps = Array.isArray(data['steps']) ? data['steps'].flatMap((value, index) => parseStep(value, index)) : [];
    return { id, turnId, goal: readString(data['goal']) ?? '', language: readString(data['language']) ?? 'en', version, totalSteps: readNumber(data['totalSteps']) ?? steps.length, steps, evidence: current?.turnId === turnId ? current.evidence : [], status: 'active', ...(steps.some(step => step.status === 'active') ? { currentStep: steps.findIndex(step => step.status === 'active') } : {}) };
  }
  if (current === undefined || current.id !== id) return current;
  if (event === 'work.evidence.recorded') {
    const evidence = parseEvidence(data['evidence']);
    if (evidence === undefined) return current;
    const steps = current.steps.map(step => step.id === evidence.stepId && !step.evidenceIds.includes(evidence.id) ? { ...step, evidenceIds: [...step.evidenceIds, evidence.id] } : step);
    return { ...current, version, steps, evidence: [...current.evidence.filter(item => item.id !== evidence.id), evidence] };
  }
  if (event === 'work.plan.completed' || event === 'work.plan.failed' || event === 'work.plan.blocked') {
    const status = event === 'work.plan.completed' ? 'completed' : event === 'work.plan.failed' ? 'failed' : 'blocked';
    return { ...current, version, status, ...(status === 'failed' || status === 'blocked' ? { error: readString(data['reason']) ?? 'Work plan stopped.' } : {}) };
  }
  if (!event.startsWith('work.task.')) return current;
  const stepId = readString(data['stepId']) ?? readString(data['taskId']);
  const status = event === 'work.task.started' ? 'active' : event === 'work.task.completed' ? 'completed' : event === 'work.task.failed' ? 'failed' : event === 'work.task.blocked' ? 'blocked' : undefined;
  if (stepId === undefined || status === undefined) return current;
  const index = current.steps.findIndex(step => step.id === stepId);
  if (index < 0) return current;
  return { ...current, version, steps: current.steps.map((step, stepIndex) => stepIndex === index ? { ...step, status } : step), ...(status === 'active' ? { currentStep: index } : {}) };
}

function parseStep(value: unknown, fallbackIndex: number): WorkPlanStepSnapshot[] {
  if (typeof value !== 'object' || value === null) return [];
  const record = value as Record<string, unknown>;
  const id = readString(record['id']); const title = readString(record['title']);
  if (id === undefined || title === undefined) return [];
  return [{ index: readNumber(record['index']) ?? fallbackIndex, id, title, description: readString(record['description']) ?? '', dependencies: readStrings(record['dependencies']), scope: readStrings(record['scope']), acceptanceCriteria: readStrings(record['acceptanceCriteria']), verificationHints: readStrings(record['verificationHints']), evidenceIds: readStrings(record['evidenceIds']), status: readWorkStepStatus(record['status']) ?? 'queued' }];
}

function parseEvidence(value: unknown): WorkEvidenceSnapshot | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const record = value as Record<string, unknown>;
  const id = readString(record['id']); const stepId = readString(record['stepId']); const kind = readEvidenceKind(record['kind']); const summary = readString(record['summary']); const createdAt = readString(record['createdAt']);
  const status = record['status'] === 'passed' || record['status'] === 'failed' || record['status'] === 'informational' ? record['status'] : undefined;
  if (id === undefined || stepId === undefined || kind === undefined || summary === undefined || createdAt === undefined || status === undefined) return undefined;
  const command = readString(record['command']); const paths = record['paths'] === undefined ? undefined : readStrings(record['paths']); const exitCode = readNumber(record['exitCode']);
  return { id, stepId, kind, summary, status, createdAt, ...(command === undefined ? {} : { command }), ...(paths === undefined ? {} : { paths }), ...(exitCode === undefined ? {} : { exitCode }) };
}

function parseLastAction(value: unknown): SubagentSnapshot['lastAction'] | undefined { if (typeof value !== 'object' || value === null) return undefined; const record = value as Record<string, unknown>; const label = readString(record['label']); return label === undefined ? undefined : { kind: readString(record['kind']) ?? 'other', label }; }
function parseHandoff(value: unknown): SubagentSnapshot['handoff'] | undefined { if (typeof value !== 'object' || value === null) return undefined; const record = value as Record<string, unknown>; const summary = readString(record['summary']); if (summary === undefined) return undefined; return { summary, filesInspected: readStrings(record['filesInspected']), filesChanged: readStrings(record['filesChanged']), commandsRun: readStrings(record['commandsRun']), verification: readStrings(record['verification']), warnings: readStrings(record['warnings']) }; }
function readStatus(value: unknown): SubagentSnapshot['status'] | undefined { return value === 'queued' || value === 'running' || value === 'completed' || value === 'completed_with_warning' || value === 'failed' || value === 'cancelled' ? value : undefined; }
function readWorkStepStatus(value: unknown): WorkPlanStepSnapshot['status'] | undefined { return value === 'queued' || value === 'active' || value === 'completed' || value === 'failed' || value === 'blocked' ? value : undefined; }
function readEvidenceKind(value: unknown): WorkEvidenceSnapshot['kind'] | undefined { return typeof value === 'string' && value.trim().length > 0 ? value : undefined; }
function readStrings(value: unknown): string[] { return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string').slice(0, 100) : []; }
