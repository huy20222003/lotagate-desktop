// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AutomationRun } from '../../../contracts/ipc/v1/automation.js';
import { AutomationRunHistory } from './AutomationRunHistory.js';

const run: AutomationRun = {
  id: 'run-1', automationId: 'automation-1', status: 'succeeded', attempt: 1, taskId: 'task-full-id', sessionId: 'session-full-id', executionCwd: 'C:\\workspace', branch: 'main', worktreePath: 'C:\\workspace',
  summary: 'The automation completed after checking the entire workspace.', changedFiles: ['src/main/index.ts', 'src/renderer/App.tsx'], artifactIds: ['artifact-1'], reviewStatus: 'not_required', createdAt: '2026-09-01T00:00:00.000Z', startedAt: '2026-09-01T00:00:01.000Z', finishedAt: '2026-09-01T00:01:00.000Z',
};

describe('AutomationRunHistory', () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it('keeps the drawer card concise and opens the full run details modal', async () => {
    Object.defineProperty(window, 'lotagate', { configurable: true, value: { automations: { runs: vi.fn().mockResolvedValue([run]) } } });
    render(<AutomationRunHistory automationId="automation-1" refreshToken={0} onCancel={vi.fn()} onRetry={vi.fn()} onReview={vi.fn()} onApproval={vi.fn()} />);

    const openDetails = await screen.findByRole('button', { name: `View details for automation run ${run.id}` });
    expect(screen.queryByText(run.taskId!)).not.toBeInTheDocument();
    expect(screen.getByText('Attempt 1')).toBeInTheDocument();
    expect(screen.getByText('View full details')).toBeInTheDocument();
    fireEvent.click(openDetails);

    await waitFor(() => expect(screen.getByRole('dialog')).toHaveTextContent(run.taskId!));
    expect(screen.getByRole('dialog')).toHaveTextContent('Changed files (2)');
    expect(screen.getByRole('dialog')).toHaveTextContent(run.artifactIds[0]!);
  });
});
