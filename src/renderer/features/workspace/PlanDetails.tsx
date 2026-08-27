import type { PlanSnapshot } from '../../../contracts/ipc/v1/workspace.js';
import { OrchestrationError } from './OrchestrationError.js';
import { PlanStep } from './PlanStep.js';

export function PlanDetails({ plan }: { plan: PlanSnapshot }) {
  return <div className="plan-details"><p className="orchestration-drawer-goal">{plan.goal}</p>{plan.steps.map(step => <PlanStep key={step.id} step={step} />)}{plan.error ? <OrchestrationError message={plan.error} /> : null}</div>;
}
