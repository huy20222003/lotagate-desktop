// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { WorkPlanSnapshot } from '../../../../contracts/ipc/v1/workspace.js';
import { formatTextClamp } from '../../../utils/text.js';
import { PlanDetails } from './PlanDetails.js';

const plan: WorkPlanSnapshot = {
  id: 'plan-1', turnId: 'turn-1', goal: 'Request '.concat('x'.repeat(320)), language: 'en', version: 1, totalSteps: 1, evidence: [], status: 'active', currentStep: 0,
  steps: [{ index: 0, id: 'step-1', title: 'Implement request', description: 'Working', dependencies: [], scope: [], acceptanceCriteria: [], verificationHints: [], evidenceIds: [], status: 'active' }],
};

describe('PlanDetails', () => {
  it('previews a long request and expands or collapses it', () => {
    render(<PlanDetails plan={plan} />);

    expect(screen.getByText('Request:')).toBeVisible();
    expect(screen.getByText(formatTextClamp(300, plan.goal))).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Show more' }));
    expect(screen.getByText(plan.goal)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Show less' }));
    expect(screen.getByText(formatTextClamp(300, plan.goal))).toBeVisible();
  });
});
