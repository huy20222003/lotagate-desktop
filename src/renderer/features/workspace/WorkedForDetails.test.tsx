// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it } from 'vitest';
import type { Activity } from '../../../contracts/ipc/v1/workspace.js';
import { WorkedForDetails } from './WorkedForDetails.js';

function toolActivity(id: string, text: string, metadata: Record<string, unknown>): Activity {
  return { id, taskId: 'task-1', kind: 'tool', text, metadata, createdAt: '2026-08-29T00:00:00.000Z' };
}

describe('WorkedForDetails', () => {
  afterEach(() => cleanup());

  it('shows the live status separately from the final transcript', () => {
    render(<WorkedForDetails statusText="I’ll inspect the workspace with List files." progressActivities={[]} toolActivities={[]} />);

    expect(screen.getByText('I’ll inspect the workspace with List files.')).toBeVisible();
  });

  it('does not repeat a completed tool below its completed status', () => {
    render(<WorkedForDetails statusText="shell.exec · completed" progressActivities={[]} toolActivities={[
      toolActivity('tool-start', 'Running shell.exec.', { actionId: 'action-1', toolName: 'shell.exec', displayName: 'shell.exec' }),
      toolActivity('tool-complete', 'shell.exec completed.', { actionId: 'action-1', toolName: 'shell.exec', displayName: 'shell.exec', status: 'completed' }),
    ]} />);

    expect(screen.getByText('shell.exec · completed')).toBeInTheDocument();
    expect(screen.queryByText('Ran shell.exec')).not.toBeInTheDocument();
  });

  it('uses the same tool name for the running label', () => {
    render(<WorkedForDetails progressActivities={[]} toolActivities={[
      toolActivity('tool-start', 'Running filesystem.list.', { actionId: 'action-2', toolName: 'filesystem.list', displayName: 'filesystem.list' }),
    ]} />);

    expect(screen.getByText('Run filesystem.list')).toBeInTheDocument();
  });
});
