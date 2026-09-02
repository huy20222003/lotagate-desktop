// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FileChangeSummary, WorkPlanSnapshot } from '../../../../contracts/ipc/v1/workspace.js';
import { ChangeSummaryChip } from './ChangeSummaryChip.js';

const plan: WorkPlanSnapshot = {
  id: 'plan-1', turnId: 'turn-1', goal: 'Update the workspace', language: 'en', version: 2, totalSteps: 3, evidence: [],
  steps: [
    { index: 0, id: 'inspect', title: 'Inspect files', description: '', dependencies: [], scope: [], acceptanceCriteria: [], verificationHints: [], evidenceIds: [], status: 'completed' },
    { index: 1, id: 'update', title: 'Update files', description: '', dependencies: [], scope: [], acceptanceCriteria: [], verificationHints: [], evidenceIds: [], status: 'active' },
    { index: 2, id: 'verify', title: 'Verify changes', description: '', dependencies: [], scope: [], acceptanceCriteria: [], verificationHints: [], evidenceIds: [], status: 'queued' },
  ], status: 'active', currentStep: 1,
};

const summary: FileChangeSummary = {
  files: [{ path: 'src/example.ts', additions: 3, deletions: 1, truncated: false, lines: [] }],
  additions: 3,
  deletions: 1,
};

describe('ChangeSummaryChip', () => {
  afterEach(() => cleanup());

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
    expect(screen.getByText('example.ts')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open example.ts in changed files' }));
    expect(onFilesClick).toHaveBeenCalledWith('src/example.ts');
    fireEvent.click(screen.getByRole('button', { name: 'Open 1 changed file' }));
    expect(onFilesClick).toHaveBeenCalledTimes(2);
    expect(onFilesClick).toHaveBeenLastCalledWith();
    expect(container.querySelectorAll('button button')).toHaveLength(0);
  });

  it('shows the file popover when no plan segment is present', () => {
    const onFilesClick = vi.fn();
    const { container } = render(<ChangeSummaryChip summary={summary} onFilesClick={onFilesClick} />);

    fireEvent.mouseEnter(container.querySelector('.change-summary-files')!);

    expect(screen.getByText('example.ts')).toBeVisible();
    expect(screen.queryByText('src/example.ts')).not.toBeInTheDocument();
  });
});
