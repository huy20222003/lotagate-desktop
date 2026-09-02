import type { WorkPlanSnapshot } from '../../../../contracts/ipc/v1/workspace.js';
import { OrchestrationError } from './OrchestrationError.js';
import { PlanStep } from './PlanStep.js';

export function PlanDetails({ plan }: { plan: WorkPlanSnapshot }) {
  return <div className="plan-details"><p className="orchestration-drawer-goal">{plan.goal}</p>{plan.steps.map(step => <PlanStep key={step.id} step={step} />)}{plan.evidence.length > 0 ? <div className="plan-evidence"><strong>Evidence</strong>{plan.evidence.map(item => <small key={item.id}>{item.status} · {item.summary}</small>)}</div> : null}{plan.error ? <OrchestrationError message={plan.error} /> : null}</div>;
}
