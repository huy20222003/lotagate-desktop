import { AlertCircle, Check, Circle, LoaderCircle } from 'lucide-react';
import type { PlanStepSnapshot } from '../../../contracts/ipc/v1/workspace.js';

export function PlanStep({ step }: { step: PlanStepSnapshot }) {
  return <div className={`plan-step plan-step-${step.status}`}>{step.status === 'completed' ? <Check size={13} /> : step.status === 'started' ? <LoaderCircle size={13} className="spin" /> : step.status === 'queued' ? <Circle size={11} /> : <AlertCircle size={13} />}<span><strong>{step.title}</strong><small>{step.description}</small></span></div>;
}
