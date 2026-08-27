import { LoaderCircle } from 'lucide-react';
import type { PlanSnapshot } from '../../../contracts/ipc/v1/workspace.js';

export function PlanProgressIndicator({ plan }: { plan: PlanSnapshot }) {
  if (plan.status !== 'started') return null;
  const step = plan.currentStep === undefined ? plan.steps.find(item => item.status === 'started' || item.status === 'queued') : plan.steps[plan.currentStep];
  if (step === undefined) return null;
  return <div className="plan-progress-indicator" aria-live="polite"><LoaderCircle size={14} className="spin" /><span>Step {step.index + 1} / {plan.totalSteps}: {step.title}</span></div>;
}
