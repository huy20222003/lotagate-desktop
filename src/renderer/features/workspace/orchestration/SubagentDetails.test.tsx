// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { describe, expect, it } from 'vitest';
import { formatTextClamp } from '../../../utils/text.js';
import { SubagentDetails } from './SubagentDetails.js';

describe('SubagentDetails', () => {
  it('presents a structured handoff when the summary contains the protocol JSON', () => {
    const handoffSummary = JSON.stringify({
      summary: 'Đã thêm dữ liệu 1234 vào file test.md.',
      filesInspected: ['test.md'],
      filesChanged: ['test.md'],
      commandsRun: ['rg --files'],
      verification: ['Đã đọc lại test.md.'],
      warnings: [],
    });
    const rawSummary = `${handoffSummary}\n${handoffSummary}`;
    const task = 'Thêm dữ liệu 1234 vào file test.md ' + 'x'.repeat(320);

    const { container } = render(<SubagentDetails subagent={{ id: 'sub-1', displayName: 'Atlas', task, mode: 'worker', model: 'model-a', status: 'completed', background: true, timestamp: 1, summary: rawSummary, handoff: { summary: rawSummary, filesInspected: [], filesChanged: [], commandsRun: [], verification: [], warnings: ['The child returned an unstructured or invalid handoff; verify the result directly.'] } }} />);

    expect(screen.getByText('Task:').parentElement).toHaveTextContent(formatTextClamp(300, task));
    expect(screen.getByText('Summary').nextElementSibling).toHaveTextContent('Đã thêm dữ liệu 1234 vào file test.md.');
    expect(screen.getByText('Files inspected').parentElement).toHaveTextContent('1');
    expect(screen.getByText('Files changed').parentElement).toHaveTextContent('1');
    expect(screen.getByText('Commands run').parentElement).toHaveTextContent('1');
    expect(screen.getByText('Verification').nextElementSibling).toHaveTextContent('Đã đọc lại test.md.');
    expect(screen.queryByText(/unstructured or invalid handoff/u)).not.toBeInTheDocument();
    expect(container.textContent).not.toContain(rawSummary);
  });

  it('uses worker-detail command styling and animation for a running last action', () => {
    const { container } = render(<SubagentDetails subagent={{ id: 'sub-1', displayName: 'Atlas', task: 'Inspect the workspace', mode: 'research', model: 'model-a', status: 'running', background: true, timestamp: 1, lastAction: { kind: 'filesystem', label: 'Read file test.md' } }} />);

    expect(container.querySelector('.worked-tool-running')).toBeInTheDocument();
    expect(container.querySelector('.worked-tool-terminal-icon')).toBeInTheDocument();
    expect(container.querySelector('.typing-label')).toHaveTextContent('Read file test.md');
  });
});
