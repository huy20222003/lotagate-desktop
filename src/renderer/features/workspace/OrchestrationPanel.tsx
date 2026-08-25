import { AlertCircle, Bot, Check, ChevronDown, Circle, LoaderCircle } from 'lucide-react';
import type { PlanSnapshot, SubagentSnapshot } from '../../../contracts/ipc/v1/workspace.js';

export function OrchestrationPanel({ plan, subagents }: { plan?: PlanSnapshot | undefined; subagents: SubagentSnapshot[] }) {
  if (plan === undefined && subagents.length === 0) return null;
  return <section className="orchestration-panel" aria-label="Agent orchestration">
    {plan ? <PlanProgress plan={plan} /> : null}
    {subagents.length > 0 ? <div className="subagent-list">{subagents.map(subagent => <SubagentRow key={subagent.id} subagent={subagent} />)}</div> : null}
  </section>;
}

function PlanProgress({ plan }: { plan: PlanSnapshot }) {
  const completed = plan.steps.filter(step => step.status === 'completed').length;
  const activeIndex = plan.currentStep ?? Math.min(completed, Math.max(0, plan.totalSteps - 1));
  return <details className="plan-progress" open={plan.status === 'started'}><summary><span className="plan-progress-icon">{plan.status === 'failed' ? <AlertCircle size={13} /> : plan.status === 'completed' ? <Check size={13} /> : <LoaderCircle size={13} className="spin" />}</span><strong>Step {Math.min(activeIndex + 1, Math.max(1, plan.totalSteps))} / {plan.totalSteps}</strong><span className="plan-progress-label">{plan.goal}</span><ChevronDown size={14} /></summary><div className="plan-step-list">{plan.steps.map(step => <div className={`plan-step plan-step-${step.status}`} key={step.id}>{step.status === 'completed' ? <Check size={13} /> : step.status === 'started' ? <LoaderCircle size={13} className="spin" /> : <Circle size={11} />}<span><strong>{step.title}</strong><small>{step.description}</small></span></div>)}{plan.error ? <p className="orchestration-error">{plan.error}</p> : null}</div></details>;
}

function SubagentRow({ subagent }: { subagent: SubagentSnapshot }) {
  const active = subagent.status === 'queued' || subagent.status === 'running';
  return <details className="subagent-row"><summary><Bot size={14} /><strong>{subagent.displayName}</strong><span className={`subagent-status subagent-status-${subagent.status}`}>{subagent.status.replaceAll('_', ' ')}</span><ChevronDown size={13} /></summary><div className="subagent-detail"><p>{subagent.task}</p>{subagent.lastAction ? <small>{subagent.lastAction.label}</small> : null}{subagent.summary ? <small>{subagent.summary}</small> : null}{subagent.handoff ? <small>{subagent.handoff.filesChanged.length} files changed · {subagent.handoff.commandsRun.length} commands</small> : null}{active ? <LoaderCircle size={13} className="spin" /> : null}</div></details>;
}
