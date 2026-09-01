import { Play, X } from 'lucide-react';
import type { Automation } from '../../../contracts/ipc/v1/automation.js';
import { Badge, Button, Icon } from '../../components/ui.js';
import { formatTime } from '../../utils/time.js';
import { automationScheduleLabel } from './automation-view-utils.js';
import { AutomationRunHistory } from './AutomationRunHistory.js';
import { OrchestrationDrawer } from '../workspace/OrchestrationDrawer.js';

interface AutomationDetailsDrawerProps {
  automation: Automation;
  workspaceName: string;
  busy: boolean;
  refreshToken: number;
  onClose: () => void;
  onRun: () => void;
  onCancel: (runId: string) => Promise<void>;
  onRetry: (runId: string) => Promise<void>;
  onReview: (runId: string, approved: boolean) => Promise<void>;
  onApproval: (runId: string, approvalId: string, approved: boolean) => Promise<void>;
}

export function AutomationDetailsDrawer({ automation, workspaceName, busy, refreshToken, onClose, onRun, onCancel, onRetry, onReview, onApproval }: AutomationDetailsDrawerProps) {
  return <OrchestrationDrawer title={`Automation · ${automation.name}`} closeIcon={X} closeLabel="Close automation details" onClose={onClose}>
    <div className="automation-drawer-content">
      <div className="automation-details-heading"><div><Badge tone={automation.enabled ? 'success' : 'neutral'}>{automation.enabled ? 'Enabled' : 'Paused'}</Badge><p>{automation.description || 'No description provided.'}</p></div><Button variant="primary" disabled={busy} onClick={onRun}><Icon icon={Play} size={14} /> Run now</Button></div>
      <section className="automation-details-section"><h3>Instructions</h3><p className="automation-details-prompt">{automation.prompt}</p></section>
      <dl className="automation-details-grid"><Detail label="Workspace" value={workspaceName} /><Detail label="Schedule" value={automationScheduleLabel(automation)} /><Detail label="Permission policy" value={automation.permissionPolicy} /><Detail label="Browser access" value={automation.browserAccess} /><Detail label="Base branch" value={automation.branch ?? 'Default (HEAD)'} /><Detail label="Model" value={automation.model ?? 'Workspace default'} /><Detail label="Worktree" value={automation.worktree ? 'Isolated worktree' : 'Current workspace'} /><Detail label="Timeout" value={`${Math.round(automation.timeoutMs / 60_000)} minutes`} /><Detail label="Retry attempts" value={String(automation.retryPolicy.maxAttempts)} /><Detail label="Notifications" value={automation.notifications ? 'Enabled' : 'Disabled'} /><Detail label="Browser session" value={automation.keepSession ? 'Keep open' : 'Close after run'} /><Detail label="Next run" value={automation.nextRunAt ? formatTime(automation.nextRunAt, { dateStyle: 'medium', timeStyle: 'short' }) : 'Manual only'} /><Detail label="Last run" value={automation.lastRunAt ? formatTime(automation.lastRunAt, { dateStyle: 'medium', timeStyle: 'short' }) : 'Never'} /></dl>
      <section className="automation-details-section"><h3>Tools</h3><p className="automation-details-value">{automation.tools.length > 0 ? automation.tools.join(', ') : 'No tools enabled'}</p></section>
      <section className="automation-details-section"><div className="automation-section-title"><div><h3>Run history</h3><p>Every attempt is retained locally for audit and retry.</p></div><Badge>{automation.retryPolicy.maxAttempts} retries</Badge></div><AutomationRunHistory automationId={automation.id} refreshToken={refreshToken} onCancel={onCancel} onRetry={onRetry} onReview={onReview} onApproval={onApproval} /></section>
    </div>
  </OrchestrationDrawer>;
}

function Detail({ label, value }: { label: string; value: string }) { return <div><dt>{label}</dt><dd title={value}>{value}</dd></div>; }
