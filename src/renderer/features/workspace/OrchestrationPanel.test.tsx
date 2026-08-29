// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it } from 'vitest';
import type { PlanSnapshot } from '../../../contracts/ipc/v1/workspace.js';
import { OrchestrationPanel } from './OrchestrationPanel.js';

const failedPlan: PlanSnapshot = {
  id: 'plan-1', goal: 'Inspect the workspace', totalSteps: 3,
  steps: [
    { index: 0, id: 'inspect', title: 'Inspect context', description: '', status: 'started' },
    { index: 1, id: 'answer', title: 'Summarize the result', description: '', status: 'queued' },
    { index: 2, id: 'verify', title: 'Verify the result', description: '', status: 'queued' },
  ], status: 'failed', error: 'The agent failed.'
};

describe('OrchestrationPanel', () => {
  afterEach(() => cleanup());

  it('does not render a failed plan as active orchestration', () => {
    render(<OrchestrationPanel plan={failedPlan} subagents={[]} />);

    expect(screen.queryByRole('region', { name: 'Agent orchestration' })).not.toBeInTheDocument();
    expect(screen.queryByText('Inspect context')).not.toBeInTheDocument();
  });
});
