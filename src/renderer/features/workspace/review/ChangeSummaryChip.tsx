import { Check, Circle, ChevronRight, LoaderCircle } from 'lucide-react';
import type { FileChangeSummary, WorkPlanSnapshot } from '../../../../contracts/ipc/v1/workspace.js';
import { useState } from 'react';
import { Icon } from '../../../components/ui.js';
import { Scrollbar } from '../../../components/Scrollbar.js';
import { fileName } from './file-change-view.js';

export function ChangeSummaryChip({ summary, plan, onPlanClick, onFilesClick }: { summary: FileChangeSummary; plan?: WorkPlanSnapshot; onPlanClick?: () => void; onFilesClick?: (path?: string) => void }) {
  const [popover, setPopover] = useState<'plan' | 'files' | undefined>();
  const hasPlan = plan?.status === 'active' && onPlanClick !== undefined;
  const hasFiles = summary.files.length > 0 && onFilesClick !== undefined;
  if (!hasPlan && !hasFiles) return null;
  return <div className={`change-summary-chip${hasPlan && hasFiles ? ' has-segments' : ''}`} onMouseLeave={() => setPopover(undefined)}>
    {hasPlan ? <div className="change-summary-segment" onMouseEnter={() => setPopover('plan')} onFocus={() => setPopover('plan')}>
      <button type="button" className="change-summary-button change-summary-plan" onClick={onPlanClick} aria-label={`Open plan, step ${planStepNumber(plan!)} of ${plan!.totalSteps}`}>
        <PlanProgressRing plan={plan!} />
        <span>Step {planStepNumber(plan!)} / {plan!.totalSteps}</span>
        <Icon icon={ChevronRight} size={13} aria-hidden="true" />
      </button>
      {popover === 'plan' ? <PlanPopover plan={plan!} /> : null}
    </div> : null}
    {hasFiles ? <div className="change-summary-segment" onMouseEnter={() => setPopover('files')} onFocus={() => setPopover('files')}>
      <button type="button" className="change-summary-button change-summary-files" onClick={() => onFilesClick?.()} aria-label={`Open ${summary.files.length} changed ${summary.files.length === 1 ? 'file' : 'files'}`}>
        <span>{summary.files.length} {summary.files.length === 1 ? 'file' : 'files'} changed</span>
        <span className="change-additions">+{summary.additions}</span>
        <span className="change-deletions">-{summary.deletions}</span>
      </button>
      {popover === 'files' ? <FileChangesPopover summary={summary} onOpenFile={path => onFilesClick?.(path)} /> : null}
    </div> : null}
  </div>;
}

function PlanProgressRing({ plan }: { plan: WorkPlanSnapshot }) {
  const total = Math.max(1, plan.steps.length);
  const circumference = 2 * Math.PI * 7;
  const segmentLength = circumference / total;
  return <svg className="change-summary-plan-ring" viewBox="0 0 20 20" aria-hidden="true">{plan.steps.map((step, index) => <circle key={step.id} cx="10" cy="10" r="7" fill="none" className={`plan-ring-segment plan-ring-segment-${step.status}`} strokeDasharray={`${Math.max(1, segmentLength - 1.8)} ${circumference - Math.max(1, segmentLength - 1.8)}`} strokeDashoffset={-index * segmentLength} transform="rotate(-90 10 10)" />)}</svg>;
}

function PlanPopover({ plan }: { plan: WorkPlanSnapshot }) {
  return <div className="change-summary-popover change-summary-plan-popover" role="tooltip">{plan.steps.map(step => <div className={`change-summary-plan-step plan-step-${step.status}`} key={step.id}>{step.status === 'completed' ? <Check size={13} /> : step.status === 'active' ? <LoaderCircle size={13} className="spin" /> : step.status === 'failed' || step.status === 'blocked' ? <Circle size={11} /> : <Circle size={11} />}<span>{step.title}</span></div>)}</div>;
}

function FileChangesPopover({ summary, onOpenFile }: { summary: FileChangeSummary; onOpenFile: (path: string) => void }) {
  return <div className="change-summary-popover change-summary-files-popover" role="tooltip"><Scrollbar className="change-summary-files-scrollbar"><div className="change-summary-files-list">{summary.files.map(file => <button type="button" className="change-summary-file" key={file.path} onClick={() => onOpenFile(file.path)} aria-label={`Open ${fileName(file.path)} in changed files`}><span>{fileName(file.path)}</span><span className="file-change-counts"><span className="change-additions">+{file.additions}</span><span className="change-deletions">-{file.deletions}</span></span></button>)}</div></Scrollbar></div>;
}

export function planStepNumber(plan: WorkPlanSnapshot): number {
  if (plan.currentStep !== undefined) return Math.min(plan.currentStep + 1, Math.max(1, plan.totalSteps));
  const completed = plan.steps.filter(step => step.status === 'completed').length;
  return Math.min(completed + 1, Math.max(1, plan.totalSteps));
}
