// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';
import type { FileChangeSummary, PlanSnapshot } from '../../../contracts/ipc/v1/workspace.js';
import { ChangeSummaryChip } from './ChangeSummaryChip.js';

const plan: PlanSnapshot = {
  id: 'plan-1', goal: 'Update the workspace', totalSteps: 3,
  steps: [
    { index: 0, id: 'inspect', title: 'Inspect files', description: '', status: 'completed' },
    { index: 1, id: 'update', title: 'Update files', description: '', status: 'started' },
    { index: 2, id: 'verify', title: 'Verify changes', description: '', status: 'queued' },
  ], status: 'started', currentStep: 1,
};

const summary: FileChangeSummary = {
  files: [{ path: 'src/example.ts', additions: 3, deletions: 1, truncated: false, lines: [] }],
  additions: 3,
  deletions: 1,
};

describe('ChangeSummaryChip', () => {
  it('shows plan progress and both hover popovers without nesting buttons', () => {
    const onPlanClick = vi.fn();
    const onFilesClick = vi.fn();
    const { container } = render(<ChangeSummaryChip plan={plan} summary={summary} onPlanClick={onPlanClick} onFilesClick={onFilesClick} />);

    expect(screen.getByText('Step 2 / 3')).toBeInTheDocument();
    expect(container.querySelector('.change-summary-plan')).not.toHaveTextContent('Update the workspace');
    fireEvent.mouseEnter(container.querySelector('.change-summary-plan')!);
    expect(screen.getByText('Inspect files')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open plan, step 2 of 3' }));
    expect(onPlanClick).toHaveBeenCalledOnce();

    fireEvent.mouseEnter(container.querySelector('.change-summary-files')!);
    expect(screen.getByText('src/example.ts')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open 1 changed file' }));
    expect(onFilesClick).toHaveBeenCalledOnce();
    expect(container.querySelectorAll('button button')).toHaveLength(0);
  });
});
