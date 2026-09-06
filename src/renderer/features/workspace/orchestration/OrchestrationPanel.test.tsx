// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it } from 'vitest';
import { OrchestrationPanel } from './OrchestrationPanel.js';

describe('OrchestrationPanel', () => {
  afterEach(() => cleanup());

  it('does not render an orchestration panel without active subagents', () => {
    render(<OrchestrationPanel subagents={[]} />);

    expect(screen.queryByRole('region', { name: 'Agent orchestration' })).not.toBeInTheDocument();
  });

  it('shows lifecycle activity and keeps completed handoff details open', () => {
    const running = { id: 'sub-1', displayName: 'Atlas', task: 'Inspect the workspace', mode: 'research' as const, model: 'model-a', status: 'running' as const, background: true, timestamp: 1, lastAction: { kind: 'filesystem', label: 'Reading src/' } };
    const { rerender } = render(<OrchestrationPanel subagents={[running]} />);

    expect(screen.getByText('Created agent Atlas')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Open Atlas' }));
    expect(screen.getByText('Reading src/')).toBeVisible();

    rerender(<OrchestrationPanel subagents={[{ ...running, status: 'completed', summary: 'Workspace inspected.', handoff: { summary: 'Workspace inspected.', filesInspected: ['src/app.ts'], filesChanged: ['src/app.ts'], commandsRun: ['rg --files'], verification: [], warnings: [] } }]} />);
    expect(screen.getByRole('complementary', { name: 'Atlas' })).toHaveTextContent('completed');
    expect(screen.getByText('Workspace inspected.')).toBeVisible();
    expect(screen.getByText('Files inspected').parentElement).toHaveTextContent('1');
    expect(screen.getByText('Files changed').parentElement).toHaveTextContent('1');
    expect(screen.getByText('Commands run').parentElement).toHaveTextContent('1');
  });

  it('shows the create activity while a subagent is queued', () => {
    render(<OrchestrationPanel subagents={[{ id: 'sub-1', displayName: 'Atlas', task: 'Inspect the workspace', mode: 'research', model: 'model-a', status: 'queued', background: true, timestamp: 1 }]} />);

    expect(screen.getByText('Create agent')).toBeVisible();
  });
});
