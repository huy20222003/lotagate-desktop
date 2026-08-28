import { randomUUID } from 'node:crypto';
import { automationApprovalSchema, automationCreateInputSchema, automationRunSchema, automationSchema, automationUpdateInputSchema, type Automation, type AutomationApproval, type AutomationCreateInput, type AutomationRun, type AutomationStateEvent, type AutomationUpdateInput } from '../../contracts/ipc/v1/automation.js';
import { JsonFileStore } from '../persistence/json-file-store.js';
import { desktopDataPath } from '../persistence/app-data-paths.js';
import { nextRunAt, validateSchedule } from './schedule.js';

export type { Automation } from '../../contracts/ipc/v1/automation.js';

const MAX_CONCURRENT_RUNS = 2;

export type AutomationExecutionResult = { taskId?: string; sessionId?: string; summary?: string; changedFiles?: string[]; artifactIds?: string[]; executionCwd?: string; branch?: string; worktreePath?: string; reviewRequired?: boolean };
export type AutomationRunner = (automation: Automation, run: AutomationRun, signal: AbortSignal) => Promise<AutomationExecutionResult>;

export interface AutomationStore { read(): Promise<Automation[]>; update(mutator: (current: Automation[]) => Automation[] | Promise<Automation[]>): Promise<Automation[]>; }
export interface AutomationRunStore { read(): Promise<AutomationRun[]>; update(mutator: (current: AutomationRun[]) => AutomationRun[] | Promise<AutomationRun[]>): Promise<AutomationRun[]>; }
type PendingApproval = { runId: string; approval: AutomationApproval; respond: (approved: boolean) => Promise<unknown>; resolve: (approved: boolean) => void };

export class AutomationService {
  private readonly store: AutomationStore;
  private readonly runStore: AutomationRunStore;
  private readonly running = new Map<string, { runId: string; controller: AbortController }>();
  private readonly listeners = new Set<(event: AutomationStateEvent) => void>();
  private readonly approvals = new Map<string, PendingApproval>();
  private timer: ReturnType<typeof setInterval> | undefined;
  private scanning = false;
  private startupRecovery: Promise<void> = Promise.resolve();

  constructor(store?: AutomationStore, runStore?: AutomationRunStore) {
    this.store = store ?? new JsonFileStore<Automation[]>(desktopDataPath('automations.json'), [], parseAutomationList);
    this.runStore = runStore ?? new JsonFileStore<AutomationRun[]>(desktopDataPath('automation-runs.json'), [], value => automationRunSchema.array().parse(value));
  }

  onState(listener: (event: AutomationStateEvent) => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  async list(): Promise<Automation[]> { return (await this.store.read()).map(item => automationSchema.parse(item)); }
  async get(id: string): Promise<Automation> { const item = (await this.list()).find(value => value.id === id); if (item === undefined) throw new Error('Automation was not found.'); return item; }
  async runs(automationId: string, limit = 100): Promise<AutomationRun[]> { return (await this.runStore.read()).filter(run => run.automationId === automationId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit).map(run => automationRunSchema.parse(run)); }

  async create(input: AutomationCreateInput): Promise<Automation> {
    const value = automationCreateInputSchema.parse(input);
    validateSchedule(value.schedule);
    const now = new Date().toISOString();
    const item = automationSchema.parse({ ...value, id: randomUUID(), enabled: true, nextRunAt: nextRunAt(value.schedule), lastRunAt: null, lastError: null, createdAt: now, updatedAt: now });
    await this.store.update(current => [...current, item]);
    this.emit({ type: 'created', automationId: item.id, automation: item });
    return item;
  }

  async update(id: string, patch: AutomationUpdateInput): Promise<Automation> {
    const value = automationUpdateInputSchema.parse(patch);
    let updated: Automation | undefined;
    await this.store.update(current => {
      const index = current.findIndex(item => item.id === id);
      if (index < 0) throw new Error('Automation was not found.');
      const previous = automationSchema.parse(current[index]);
      const next = automationSchema.parse({ ...previous, ...value, id, updatedAt: new Date().toISOString(), ...(value.schedule === undefined ? {} : { nextRunAt: nextRunAt(value.schedule) }), ...(value.enabled === false ? { nextRunAt: null } : {}) });
      validateSchedule(next.schedule);
      const items = [...current]; items[index] = next; updated = next; return items;
    });
    if (updated === undefined) throw new Error('Automation update failed.');
    this.emit({ type: updated.enabled ? 'updated' : 'paused', automationId: id, automation: updated });
    return updated;
  }

  async remove(id: string): Promise<void> {
    if (this.running.has(id)) throw new Error('Stop the automation run before deleting it.');
    await this.get(id);
    await this.store.update(current => current.filter(item => item.id !== id));
    await this.runStore.update(current => current.filter(run => run.automationId !== id));
    this.emit({ type: 'removed', automationId: id });
  }

  async pause(id: string): Promise<Automation> { return this.update(id, { enabled: false }); }
  async resume(id: string): Promise<Automation> {
    const item = await this.get(id);
    const resumed = await this.update(id, { enabled: true, schedule: item.schedule });
    this.emit({ type: 'resumed', automationId: id, automation: resumed });
    return resumed;
  }

  start(runner: AutomationRunner, pollMs = 60_000): void {
    this.stop();
    this.startupRecovery = this.recoverInterruptedRuns();
    this.timer = setInterval(() => { void this.runDue(runner).catch(() => undefined); }, pollMs);
    void this.runDue(runner).catch(() => undefined);
  }
  async runDueNow(runner: AutomationRunner): Promise<void> { await this.runDue(runner); }
  stop(): void {
    if (this.timer !== undefined) clearInterval(this.timer);
    this.timer = undefined;
    for (const active of this.running.values()) active.controller.abort();
  }

  async run(id: string, runner: (automation: Automation) => Promise<void>): Promise<Automation> { await this.executeRun(id, async automation => { await runner(automation); return {}; }, true); return this.get(id); }
  async runNow(id: string, runner: AutomationRunner): Promise<AutomationRun> { return this.executeRun(id, runner, true); }
  async retry(runId: string, runner: AutomationRunner): Promise<AutomationRun> {
    const previous = (await this.runStore.read()).find(run => run.id === runId);
    if (previous === undefined) throw new Error('Automation run was not found.');
    return this.executeRun(previous.automationId, runner, true);
  }

  async cancel(runId: string): Promise<AutomationRun> {
    const active = [...this.running.entries()].find(([, value]) => value.runId === runId);
    if (active === undefined) throw new Error('Automation run is not running.');
    await this.clearApprovals(runId);
    active[1].controller.abort();
    const run = await this.findRun(runId);
    return this.updateRun(run, { status: 'cancelled', finishedAt: new Date().toISOString(), error: 'Cancelled by the user.' });
  }

  async requestApproval(runId: string, input: Omit<AutomationApproval, 'requestedAt'>, respond: (approved: boolean) => Promise<unknown>, onRegistered?: (approval: AutomationApproval) => void): Promise<boolean> {
    const run = await this.findRun(runId);
    if (run.status !== 'running' && run.status !== 'awaiting_approval') throw new Error('This automation run is not active.');
    const approval = automationApprovalSchema.parse({ ...input, requestedAt: new Date().toISOString() });
    const updated = await this.updateRun(run, { status: 'awaiting_approval', pendingApproval: approval });
    const automation = await this.get(run.automationId);
    const decision = new Promise<boolean>(resolve => { this.approvals.set(approval.approvalId, { runId, approval, respond, resolve }); });
    this.emit({ type: 'approval_requested', automationId: automation.id, automation, run: updated });
    onRegistered?.(approval);
    return decision;
  }

  async respondApproval(runId: string, approvalId: string, approved: boolean): Promise<AutomationRun> {
    const pending = this.approvals.get(approvalId);
    if (pending === undefined || pending.runId !== runId) throw new Error('This automation approval is no longer active.');
    await pending.respond(approved);
    this.approvals.delete(approvalId);
    pending.resolve(approved);
    const run = await this.findRun(runId);
    const updated = await this.updateRun(run, { status: 'running', pendingApproval: undefined });
    const automation = await this.get(updated.automationId);
    this.emit({ type: 'updated', automationId: automation.id, automation, run: updated });
    return updated;
  }

  async review(runId: string, approved: boolean): Promise<AutomationRun> {
    const run = await this.findRun(runId);
    if (run.status !== 'awaiting_review' || run.reviewStatus !== 'pending') throw new Error('This automation run is not awaiting review.');
    const updated = await this.updateRun(run, { status: approved ? 'succeeded' : 'failed', reviewStatus: approved ? 'approved' : 'rejected', ...(approved ? {} : { error: 'Rejected during human review.' }) });
    const automation = await this.get(run.automationId);
    await this.store.update(current => current.map(item => item.id === automation.id ? automationSchema.parse({ ...item, lastError: approved ? null : updated.error ?? 'Rejected during human review.', updatedAt: new Date().toISOString() }) : item));
    this.emit({ type: 'reviewed', automationId: automation.id, automation: await this.get(automation.id), run: updated });
    return updated;
  }

  private async executeRun(id: string, runner: AutomationRunner, force: boolean): Promise<AutomationRun> {
    if (this.running.has(id)) throw new Error('Automation is already running.');
    if (this.running.size >= MAX_CONCURRENT_RUNS) throw new Error('The automation runner is at capacity.');
    const controller = new AbortController();
    const reservation = { runId: randomUUID(), controller };
    this.running.set(id, reservation);
    let automation: Automation;
    let run: AutomationRun;
    try {
      automation = await this.get(id);
      if (!force && !automation.enabled) throw new Error('Automation is paused.');
      const createdAt = new Date().toISOString();
      run = automationRunSchema.parse({ id: reservation.runId, automationId: id, status: 'queued', attempt: 1, changedFiles: [], artifactIds: [], reviewStatus: 'not_required', createdAt });
      await this.runStore.update(current => [...current, run]);
    } catch (error) {
      this.running.delete(id);
      throw error;
    }
    this.emit({ type: 'started', automationId: id, automation, run });
    try {
      for (let attempt = 1; attempt <= automation.retryPolicy.maxAttempts + 1; attempt += 1) {
        run = await this.updateRun(run, { status: 'running', attempt, startedAt: run.startedAt ?? new Date().toISOString(), error: undefined });
        try {
          const result = await runWithTimeout(() => runner(automation, run, controller.signal), automation.timeoutMs, controller);
          if (controller.signal.aborted) throw new Error('Automation run was cancelled by the user.');
          run = await this.updateRun(run, { status: result.reviewRequired ? 'awaiting_review' : 'succeeded', taskId: result.taskId, sessionId: result.sessionId, executionCwd: result.executionCwd, branch: result.branch, worktreePath: result.worktreePath, summary: result.summary, changedFiles: result.changedFiles ?? [], artifactIds: result.artifactIds ?? [], reviewStatus: result.reviewRequired ? 'pending' : 'not_required', finishedAt: new Date().toISOString() });
          this.emit({ type: 'completed', automationId: id, automation, run });
          return run;
        } catch (error) {
          if (error instanceof TimeoutError) { run = await this.updateRun(run, { status: 'timed_out', error: error.message, finishedAt: new Date().toISOString() }); this.emit({ type: 'failed', automationId: id, automation, run }); return run; }
          if (controller.signal.aborted) { run = await this.updateRun(run, { status: 'cancelled', error: 'Automation run was cancelled by the user.', finishedAt: new Date().toISOString() }); this.emit({ type: 'cancelled', automationId: id, automation, run }); return run; }
          const message = error instanceof Error ? error.message : 'Automation run failed.';
          if (attempt <= automation.retryPolicy.maxAttempts) { run = await this.updateRun(run, { status: 'queued', error: message }); await waitForRetry(automation.retryPolicy.backoffMs * attempt, controller.signal); continue; }
          run = await this.updateRun(run, { status: error instanceof TimeoutError ? 'timed_out' : 'failed', error: message, finishedAt: new Date().toISOString() });
          this.emit({ type: 'failed', automationId: id, automation, run });
          return run;
        }
      }
    } finally {
      await this.clearApprovals(run.id);
      this.running.delete(id);
      await this.recordCompletion(automation, run);
    }
    return run;
  }

  private async runDue(runner: AutomationRunner): Promise<void> {
    await this.startupRecovery;
    if (this.scanning) return;
    this.scanning = true;
    try {
      const now = Date.now();
      const pending: Promise<unknown>[] = [];
      for (const automation of await this.list()) {
        if (this.running.size >= MAX_CONCURRENT_RUNS) break;
        if (!automation.enabled || automation.nextRunAt === null || Date.parse(automation.nextRunAt) > now || this.running.has(automation.id)) continue;
        pending.push(this.executeRun(automation.id, runner, false).catch(() => undefined));
      }
      await Promise.all(pending);
    } finally { this.scanning = false; }
  }

  private async recoverInterruptedRuns(): Promise<void> {
    const interrupted: AutomationRun[] = [];
    await this.runStore.update(current => current.map(item => {
      if (item.status !== 'queued' && item.status !== 'running') return item;
      const run = automationRunSchema.parse({ ...item, status: 'failed', error: 'Desktop restarted before this automation run completed.', finishedAt: new Date().toISOString() });
      interrupted.push(run);
      return run;
    }));
    for (const run of interrupted) {
      const automation = await this.get(run.automationId).catch(() => undefined);
      if (automation !== undefined) this.emit({ type: 'failed', automationId: automation.id, automation, run });
    }
  }

  private async clearApprovals(runId: string): Promise<void> {
    const pending = [...this.approvals.entries()].filter(([, item]) => item.runId === runId);
    for (const [approvalId, item] of pending) {
      await item.respond(false).catch(() => undefined);
      this.approvals.delete(approvalId);
      item.resolve(false);
    }
  }

  private async recordCompletion(automation: Automation, run: AutomationRun): Promise<void> {
    const completedAt = run.finishedAt ?? new Date().toISOString();
    const next = automation.schedule.kind === 'once' ? null : nextRunAt(automation.schedule, new Date(completedAt));
    await this.store.update(current => current.map(item => item.id === automation.id ? automationSchema.parse({ ...item, enabled: automation.schedule.kind === 'once' ? false : item.enabled, nextRunAt: next, lastRunAt: completedAt, lastError: run.status === 'succeeded' || run.status === 'awaiting_review' ? null : run.error ?? 'Automation run failed.', updatedAt: completedAt }) : item));
  }

  private async findRun(id: string): Promise<AutomationRun> { const run = (await this.runStore.read()).find(item => item.id === id); if (run === undefined) throw new Error('Automation run was not found.'); return automationRunSchema.parse(run); }
  private async updateRun(run: AutomationRun, patch: Partial<AutomationRun>): Promise<AutomationRun> { let updated!: AutomationRun; await this.runStore.update(current => current.map(item => item.id === run.id ? (updated = automationRunSchema.parse({ ...item, ...patch })) : item)); if (!updated) throw new Error('Automation run update failed.'); return updated; }
  private emit(event: AutomationStateEvent): void { for (const listener of this.listeners) listener(event); }
}

function parseAutomationList(value: unknown): Automation[] {
  return automationSchema.array().parse(value);
}

async function runWithTimeout<T>(operation: () => Promise<T>, timeoutMs: number, controller: AbortController): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new TimeoutError()); }, timeoutMs); });
  try { return await Promise.race([operation(), timeout]); } finally { if (timer !== undefined) clearTimeout(timer); }
}
class TimeoutError extends Error { constructor() { super('Automation run timed out.'); this.name = 'TimeoutError'; } }
function waitForRetry(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(new Error('Automation run was cancelled by the user.'));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds);
    const abort = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); reject(new Error('Automation run was cancelled by the user.')); };
    const complete = () => signal.removeEventListener('abort', abort);
    const originalResolve = resolve;
    resolve = value => { complete(); originalResolve(value); };
    signal.addEventListener('abort', abort, { once: true });
  });
}
