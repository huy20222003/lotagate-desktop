// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Activity } from '../../../contracts/ipc/v1/workspace.js';
import { WorkedForDetails } from './WorkedForDetails.js';

function toolActivity(id: string, text: string, metadata: Record<string, unknown>): Activity {
  return { id, taskId: 'task-1', kind: 'tool', text, metadata, createdAt: '2026-08-29T00:00:00.000Z' };
}

describe('WorkedForDetails', () => {
  afterEach(() => { cleanup(); vi.useRealTimers(); });

  it('shows the live status separately from the final transcript', () => {
    render(<WorkedForDetails statusText="I’ll inspect the workspace with List files." activities={[]} />);

    expect(screen.getByText('I’ll inspect the workspace with List files.')).toBeVisible();
  });

  it('keeps a completed tool in Worked For after the live status changes', () => {
    render(<WorkedForDetails statusText="shell.exec · completed" activities={[
      toolActivity('tool-start', 'Running shell.exec.', { actionId: 'action-1', toolName: 'shell.exec', displayName: 'shell.exec' }),
      toolActivity('tool-complete', 'shell.exec completed.', { actionId: 'action-1', toolName: 'shell.exec', displayName: 'shell.exec', status: 'completed' }),
    ]} />);

    expect(screen.getByText('shell.exec · completed')).toBeInTheDocument();
    expect(screen.getByText('Ran command')).toBeInTheDocument();
  });

  it('uses the same tool name for the running label', () => {
    render(<WorkedForDetails activities={[
      toolActivity('tool-start', 'Running filesystem.list.', { actionId: 'action-2', toolName: 'filesystem.list', displayName: 'filesystem.list' }),
    ]} />);

    expect(screen.getByText('Run List files')).toBeInTheDocument();
  });

  it('uses the canonical formatter for MCP tools', () => {
    render(<WorkedForDetails activities={[
      toolActivity('mcp-start', 'Running mcp__tavily__tavily_search.', { actionId: 'action-3', toolName: 'mcp__tavily__tavily_search', displayName: 'mcp__tavily__tavily_search' }),
    ]} />);

    expect(screen.getByText('Run Tavily Search')).toBeInTheDocument();
  });

  it('reveals live progress text gradually', () => {
    vi.useFakeTimers();
    const content = 'Đang kiểm tra nội dung của workspace và chuẩn bị cập nhật kết quả cho anh. '.repeat(3).trimEnd();
    const activity = toolActivity('progress-1', content, { turnId: 'turn-1', assistantPhase: 'progress' });
    const { container } = render(<WorkedForDetails active activities={[{ ...activity, kind: 'assistant' }]} />);
    const progress = container.querySelector('.worked-progress');

    expect(progress).not.toHaveTextContent(content);
    for (let frame = 0; frame < 30; frame += 1) act(() => vi.advanceTimersByTime(16));
    expect(progress).toHaveTextContent(content);
  });

  it('renders progress and tools in the order received from the agent', () => {
    const progress = (id: string, text: string): Activity => ({ id, taskId: 'task-1', kind: 'assistant', text, metadata: { turnId: 'turn-1', segmentId: id, assistantPhase: 'progress' }, createdAt: '2026-08-29T00:00:00.000Z' });
    const activities: Activity[] = [
      progress('progress-check', 'Checking the current file.'),
      toolActivity('read-start', 'Running filesystem.list.', { actionId: 'read', toolName: 'filesystem.list', displayName: 'filesystem.list' }),
      toolActivity('read-complete', 'filesystem.list completed.', { actionId: 'read', toolName: 'filesystem.list', displayName: 'filesystem.list', status: 'completed' }),
      progress('progress-update', 'Updating the file now.'),
      toolActivity('write-start', 'Running filesystem.write.', { actionId: 'write', toolName: 'filesystem.write', displayName: 'filesystem.write' }),
      toolActivity('write-complete', 'filesystem.write completed.', { actionId: 'write', toolName: 'filesystem.write', displayName: 'filesystem.write', status: 'completed' }),
    ];
    const { container } = render(<WorkedForDetails activities={activities} />);

    expect(Array.from(container.querySelector('.worked-details')?.children ?? []).map(item => item.textContent)).toEqual([
      'Checking the current file.', 'Ran List files', 'Updating the file now.', 'Ran Write file',
    ]);
  });
});
