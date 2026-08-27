import { Bot, ChevronRight, ListChecks, LoaderCircle } from 'lucide-react';
import { useState } from 'react';
import type { PlanSnapshot, SubagentSnapshot } from '../../../contracts/ipc/v1/workspace.js';
import { OrchestrationDrawer } from './OrchestrationDrawer.js';
import { PlanDetails } from './PlanDetails.js';
import { SubagentDetails } from './SubagentDetails.js';

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

function planStepNumber(plan: PlanSnapshot): number {
  if (plan.currentStep !== undefined) return Math.min(plan.currentStep + 1, Math.max(1, plan.totalSteps));
  const completed = plan.steps.filter(step => step.status === 'completed').length;
  return Math.min(completed + 1, Math.max(1, plan.totalSteps));
}
