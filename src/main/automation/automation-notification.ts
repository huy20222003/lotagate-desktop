import type { AutomationStateEvent, AutomationRun } from '../../contracts/ipc/v1/automation.js';

export interface AutomationNotification {
  title: string;
  body: string;
}

export function automationNotification(event: AutomationStateEvent): AutomationNotification | undefined {
  const automation = event.automation;
  const run = event.run;
  if (automation === undefined || run === undefined) return undefined;
  const subject = `Automation · ${automation.name}`;
  if (event.type === 'approval_requested' && run.pendingApproval !== undefined) return { title: subject, body: `Approval required to ${run.pendingApproval.displayName}.` };
  if (event.type === 'completed') {
    if (run.status === 'awaiting_review') return { title: subject, body: `Completed and waiting for review.${resultSuffix(run)}` };
    if (run.status === 'succeeded') return { title: subject, body: `Completed successfully.${resultSuffix(run)}` };
  }
  if (event.type === 'failed') return { title: subject, body: `Run failed.${run.error === undefined ? '' : ` ${run.error}`}` };
  if (event.type === 'cancelled') return { title: subject, body: 'Run cancelled.' };
  if (event.type === 'reviewed') return run.reviewStatus === 'approved'
    ? { title: subject, body: `Review approved.${resultSuffix(run)}` }
    : { title: subject, body: `Review rejected.${run.error === undefined ? '' : ` ${run.error}`}` };
  return undefined;
}

function resultSuffix(run: AutomationRun): string {
  const summary = run.summary?.trim();
  return summary === undefined || summary.length === 0 ? '' : ` Result: ${summary.slice(0, 1_000)}`;
}
