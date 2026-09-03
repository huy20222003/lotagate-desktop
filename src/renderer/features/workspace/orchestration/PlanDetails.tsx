import { useState } from 'react';
import type { WorkPlanSnapshot } from '../../../../contracts/ipc/v1/workspace.js';
import { formatTextClamp } from '../../../utils/text.js';
import { OrchestrationError } from './OrchestrationError.js';
import { PlanStep } from './PlanStep.js';

const PLAN_REQUEST_PREVIEW_LENGTH = 300;

export function PlanDetails({ plan }: { plan: WorkPlanSnapshot }) {
  const [requestExpanded, setRequestExpanded] = useState(false);
  const collapsible = plan.goal.length > PLAN_REQUEST_PREVIEW_LENGTH;
  const request = requestExpanded || !collapsible ? plan.goal : formatTextClamp(PLAN_REQUEST_PREVIEW_LENGTH, plan.goal);
  return <div className="plan-details"><section className="plan-request"><strong>Request:</strong><p className="orchestration-drawer-goal">{request}</p>{collapsible ? <button className="show-more" onClick={() => setRequestExpanded(current => !current)}>{requestExpanded ? 'Show less' : 'Show more'}</button> : null}</section>{plan.steps.map(step => <PlanStep key={step.id} step={step} />)}{plan.evidence.length > 0 ? <div className="plan-evidence"><strong>Evidence</strong>{plan.evidence.map(item => <small key={item.id}>{item.status} · {item.summary}</small>)}</div> : null}{plan.error ? <OrchestrationError message={plan.error} /> : null}</div>;
}
