import type { Automation, AutomationRun, AutomationRunStatus } from '../../../contracts/ipc/v1/automation.js';
import { formatTime } from '../../utils/time.js';

export function automationScheduleLabel(automation: Automation): string {
  const schedule = automation.schedule;
  if (schedule.kind === 'manual') return 'Manual only';
  if (schedule.kind === 'once') return `Once · ${formatTime(schedule.at, { dateStyle: 'medium', timeStyle: 'short' })}`;
  if (schedule.kind === 'interval') return `Every ${schedule.everyMinutes} min`;
  if (schedule.kind === 'daily') return `Daily at ${schedule.time}`;
  if (schedule.kind === 'weekly') return `Weekly · ${schedule.time}`;
  return `Cron · ${schedule.expression}`;
}

export function automationRunStatusTone(status: AutomationRunStatus): 'success' | 'warning' | 'danger' | 'neutral' {
  if (status === 'succeeded') return 'success';
  if (status === 'awaiting_review' || status === 'awaiting_approval' || status === 'queued' || status === 'running') return 'warning';
  if (status === 'failed' || status === 'timed_out') return 'danger';
  return 'neutral';
}

export function automationRunSummary(run: AutomationRun): string {
  if (run.pendingApproval !== undefined) return `${run.pendingApproval.displayName} is waiting for your approval.`;
  return run.summary ?? run.error ?? 'No summary was returned.';
}
