import { AlertCircle, Bot, Check, ChevronRight, Circle, LoaderCircle, ListChecks } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import type { PlanSnapshot, PlanStepSnapshot, SubagentSnapshot } from '../../../contracts/ipc/v1/workspace.js';

export function OrchestrationPanel({ plan, subagents }: { plan?: PlanSnapshot | undefined; subagents: SubagentSnapshot[] }) {
  const visiblePlan = plan !== undefined && plan.status !== 'completed' ? plan : undefined;
  const activeSubagents = subagents.filter(subagent => subagent.status === 'queued' || subagent.status === 'running');
  const [drawer, setDrawer] = useState<'plan' | string | undefined>();
  const selectedSubagent = drawer !== undefined && drawer !== 'plan' ? activeSubagents.find(subagent => subagent.id === drawer) : undefined;
  if (visiblePlan === undefined && activeSubagents.length === 0) return null;
  const queued = activeSubagents.filter(subagent => subagent.status === 'queued');
  const createdLabel = activeSubagents.map(subagent => subagent.displayName).join(', ');
  return <>
    <section className="orchestration-panel" aria-label="Agent orchestration">
      {queued.length > 0 ? <div className="orchestration-activity" aria-live="polite"><LoaderCircle size={14} className="spin" /><span>Create agent</span></div> : activeSubagents.length > 0 ? <div className="orchestration-activity" aria-live="polite"><Bot size={14} /><span>Created agent {createdLabel}</span></div> : null}
      <div className="orchestration-toolbar">
        {visiblePlan ? <button type="button" className={`orchestration-chip ${drawer === 'plan' ? 'selected' : ''}`} onClick={() => setDrawer(current => current === 'plan' ? undefined : 'plan')}><span className="orchestration-chip-icon"><ListChecks size={14} /></span><strong>Step {planStepNumber(visiblePlan)} / {visiblePlan.totalSteps}</strong><span>{visiblePlan.goal}</span><ChevronRight size={14} /></button> : null}
        {activeSubagents.map(subagent => <button type="button" key={subagent.id} className={`subagent-chip ${drawer === subagent.id ? 'selected' : ''}`} aria-label={`Open ${subagent.displayName}`} title={subagent.displayName} onClick={() => setDrawer(current => current === subagent.id ? undefined : subagent.id)}><Bot size={15} /><span className={`subagent-chip-status subagent-chip-status-${subagent.status}`} /></button>)}
      </div>
    </section>
    {drawer === 'plan' && visiblePlan ? <OrchestrationDrawer title={`Plan · Step ${planStepNumber(visiblePlan)} / ${visiblePlan.totalSteps}`} onClose={() => setDrawer(undefined)}><PlanDetails plan={visiblePlan} /></OrchestrationDrawer> : null}
    {selectedSubagent ? <OrchestrationDrawer title={selectedSubagent.displayName} onClose={() => setDrawer(undefined)}><SubagentDetails subagent={selectedSubagent} /></OrchestrationDrawer> : null}
  </>;
}

function OrchestrationDrawer({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  return <aside className="orchestration-drawer" aria-label={title}><header><strong>{title}</strong><button type="button" className="icon-button" aria-label="Close orchestration details" onClick={onClose}><ChevronRight size={16} /></button></header><div className="orchestration-drawer-content">{children}</div></aside>;
}

function PlanDetails({ plan }: { plan: PlanSnapshot }) {
  return <div className="plan-details"><p className="orchestration-drawer-goal">{plan.goal}</p>{plan.steps.map(step => <PlanStep key={step.id} step={step} />)}{plan.error ? <p className="orchestration-error">{plan.error}</p> : null}</div>;
}

function PlanStep({ step }: { step: PlanStepSnapshot }) {
  return <div className={`plan-step plan-step-${step.status}`}>{step.status === 'completed' ? <Check size={13} /> : step.status === 'started' ? <LoaderCircle size={13} className="spin" /> : step.status === 'queued' ? <Circle size={11} /> : <AlertCircle size={13} />}<span><strong>{step.title}</strong><small>{step.description}</small></span></div>;
}

function SubagentDetails({ subagent }: { subagent: SubagentSnapshot }) {
  return <div className="subagent-details"><div className="subagent-detail-status"><span className={`subagent-status subagent-status-${subagent.status}`}>{subagent.status.replaceAll('_', ' ')}</span><span>{subagent.model}</span></div><p>{subagent.task}</p>{subagent.lastAction ? <small>{subagent.lastAction.label}</small> : null}{subagent.summary ? <small>{subagent.summary}</small> : null}{subagent.handoff ? <div className="subagent-handoff"><span>{subagent.handoff.filesInspected.length} files inspected</span><span>{subagent.handoff.filesChanged.length} files changed</span><span>{subagent.handoff.commandsRun.length} commands</span></div> : null}</div>;
}

function planStepNumber(plan: PlanSnapshot): number {
  if (plan.currentStep !== undefined) return Math.min(plan.currentStep + 1, Math.max(1, plan.totalSteps));
  const completed = plan.steps.filter(step => step.status === 'completed').length;
  return Math.min(completed + 1, Math.max(1, plan.totalSteps));
}
