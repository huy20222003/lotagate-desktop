// @vitest-environment jsdom
import { act, cleanup, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Activity, SubagentSnapshot } from '../../../../contracts/ipc/v1/workspace.js';
import { WorkedForDetails } from './WorkedForDetails.js';

function toolActivity(id: string, text: string, metadata: Record<string, unknown>): Activity {
  return { id, taskId: 'task-1', kind: 'tool', text, metadata, createdAt: '2026-08-29T00:00:00.000Z' };
}

function subagent(status: SubagentSnapshot['status']): SubagentSnapshot {
  return { id: 'subagent-1', displayName: 'Atlas', task: 'Inspect the workspace', mode: 'research', model: 'model-a', status, background: true, timestamp: 1 };
}

describe('WorkedForDetails', () => {
  afterEach(() => { cleanup(); vi.useRealTimers(); });

  it('shows the live status separately from the final transcript', () => {
    render(<WorkedForDetails statusText="I’ll inspect the workspace with List files." activities={[]} />);

    expect(screen.getByText('I’ll inspect the workspace with List files.')).toBeVisible();
  });

  it('keeps a completed tool in Worked For after the live status changes', () => {
    const { container } = render(<WorkedForDetails statusText="shell.exec · completed" activities={[
      toolActivity('tool-start', 'Running shell.exec.', { actionId: 'action-1', toolName: 'shell.exec', displayName: 'shell.exec' }),
      toolActivity('tool-complete', 'shell.exec completed.', { actionId: 'action-1', toolName: 'shell.exec', displayName: 'shell.exec', status: 'completed' }),
    ]} />);

    expect(screen.getByText('shell.exec · completed')).toBeInTheDocument();
    expect(container.querySelector('summary')).not.toBeInTheDocument();
    expect(container.querySelector('.worked-tool')).toHaveTextContent('Ran command');
  });

  it('uses the same tool name for the running label', () => {
    const { container } = render(<WorkedForDetails activities={[
      toolActivity('tool-start', 'Running filesystem.list.', { actionId: 'action-2', toolName: 'filesystem.list', displayName: 'filesystem.list' }),
    ]} />);

    expect(container.querySelector('summary')).not.toBeInTheDocument();
    expect(container.querySelector('.worked-tool')).toHaveTextContent('Run List files');
  });

  it('renders the formatted shell command with a terminal icon', () => {
    const { container } = render(<WorkedForDetails activities={[
      toolActivity('tool-start', 'Running shell.exec.', { actionId: 'action-shell', toolName: 'shell.exec', displayName: 'shell.exec', command: 'Get-Content test.md' }),
      toolActivity('tool-complete', 'shell.exec completed.', { actionId: 'action-shell', toolName: 'shell.exec', displayName: 'shell.exec', status: 'completed' }),
    ]} />);

    expect(container.querySelector('.worked-tool')).toHaveTextContent('Ran Get-Content test.md');
    expect(container.querySelector('.worked-tool-terminal-icon')).toBeInTheDocument();
  });

  it('shows the subagent lifecycle in Worked For details', () => {
    const { rerender } = render(<WorkedForDetails activities={[]} subagents={[subagent('queued')]} />);
    expect(screen.getByText('Create agent')).toBeVisible();

    rerender(<WorkedForDetails activities={[]} subagents={[subagent('running')]} />);
    expect(screen.getByText('Created agent Atlas')).toBeVisible();
  });

  it('keeps the full command available while CSS constrains the one-line preview', () => {
    const command = `powershell.exe -NoProfile -NonInteractive -Command ${'Get-ChildItem -Recurse -Force; '.repeat(12)}`.trim();
    const { container } = render(<WorkedForDetails activities={[toolActivity('tool-start', 'Running shell.exec.', { actionId: 'action-long-shell', toolName: 'shell.exec', displayName: 'shell.exec', command })]} />);
    const label = container.querySelector('.worked-tool > span');

    expect(label).toHaveTextContent(`Run ${command}`);
    expect(label).toHaveAttribute('title', command);
  });

  it('uses the canonical formatter for MCP tools', () => {
    const { container } = render(<WorkedForDetails activities={[
      toolActivity('mcp-start', 'Running mcp__tavily__tavily_search.', { actionId: 'action-3', toolName: 'mcp__tavily__tavily_search', displayName: 'mcp__tavily__tavily_search' }),
    ]} />);

    expect(container.querySelector('summary')).not.toBeInTheDocument();
    expect(container.querySelector('.worked-tool')).toHaveTextContent('Run Tavily Search');
  });

  it('shows the file name and write diff counts for filesystem activity', () => {
    const { container } = render(<WorkedForDetails activities={[
      toolActivity('write-start', 'Running filesystem.write.', { actionId: 'write-file', toolName: 'filesystem.write', displayName: 'filesystem.write' }),
      toolActivity('write-complete', 'filesystem.write completed.', { actionId: 'write-file', toolName: 'filesystem.write', displayName: 'Write file test.js', status: 'completed', fileChange: { path: 'test.js', additions: 3, deletions: 1 } }),
    ]} />);

    expect(container.querySelector('.worked-tool')).toHaveTextContent('Ran Write file test.js +3 -1');
  });

  it('keeps detailed file activity when a generic completion arrives afterwards', () => {
    const { container } = render(<WorkedForDetails activities={[
      toolActivity('read-start', 'Running filesystem.read.', { actionId: 'read-file', toolName: 'filesystem.read', displayName: 'filesystem.read' }),
      toolActivity('read-detail', 'Read file plan-test.md completed.', { actionId: 'read-file', toolName: 'filesystem.read', displayName: 'Read file plan-test.md', status: 'completed' }),
      toolActivity('read-generic-complete', 'Read file completed.', { actionId: 'read-file', toolName: 'filesystem.read', displayName: 'filesystem.read', status: 'completed' }),
    ]} />);

    expect(container.querySelector('.worked-tool')).toHaveTextContent('Ran Read file plan-test.md');
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

  it('renders progress and grouped tools in the order received from the agent', () => {
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

    expect(Array.from(container.querySelector('.worked-details')?.children ?? []).map(item => item.querySelector('summary')?.textContent ?? item.textContent)).toEqual([
      'Checking the current file.', 'Ran List files', 'Updating the file now.', 'Ran Write file',
    ]);
  });

  it('renders context compaction in Worked For using command-status styling', () => {
    const { container, rerender } = render(<WorkedForDetails activities={[{
      id: 'context-compaction:task-1:turn-1', taskId: 'task-1', kind: 'context', text: 'Context automatically compacting.',
      metadata: { turnId: 'turn-1', desktopContextCompactionId: 'turn-1', desktopContextCompactionPhase: 'compacting' }, createdAt: '2026-08-29T00:00:00.000Z',
    }]} />);

    expect(container.querySelector('.worked-tool-running')).toHaveTextContent('Context automatically compacting');
    expect(container.querySelector('.context-compaction-status')).not.toBeInTheDocument();

    rerender(<WorkedForDetails activities={[{
      id: 'context-compaction:task-1:turn-1', taskId: 'task-1', kind: 'context', text: 'Context automatically compacted.',
      metadata: { turnId: 'turn-1', desktopContextCompactionId: 'turn-1', desktopContextCompactionPhase: 'compacted' }, createdAt: '2026-08-29T00:00:00.000Z',
    }]} />);

    expect(container.querySelector('.worked-tool-completed')).toHaveTextContent('Context automatically compacted');
    expect(container.querySelector('.worked-tool-completed')).not.toHaveClass('context-compaction-compacted');
  });

  it('collapses consecutive tools while showing the running tool in the summary', () => {
    const { container } = render(<WorkedForDetails activities={[
      toolActivity('read-complete', 'filesystem.list completed.', { actionId: 'read', toolName: 'filesystem.list', displayName: 'filesystem.list', status: 'completed' }),
      toolActivity('write-start', 'Running filesystem.write.', { actionId: 'write', toolName: 'filesystem.write', displayName: 'filesystem.write' }),
    ]} />);

    const group = container.querySelector('.worked-tool-group');
    expect(group).not.toHaveAttribute('open');
    expect(within(group!.querySelector('summary')!).getByText('Run Write file')).toBeVisible();
    expect(within(group!.querySelector('.worked-tool-group-items')!).getByText('Ran List files')).toBeInTheDocument();
    expect(group!.querySelectorAll('.worked-tool-terminal-icon')).toHaveLength(3);
  });

  it('replaces a running command summary and keeps ordered commands when completed', () => {
    const activities: Activity[] = [
      toolActivity('first-start', 'Running shell.exec.', { actionId: 'first', toolName: 'shell.exec', command: 'Get-Content test.md' }),
      toolActivity('first-complete', 'shell.exec completed.', { actionId: 'first', toolName: 'shell.exec', status: 'completed' }),
      toolActivity('second-start', 'Running shell.exec.', { actionId: 'second', toolName: 'shell.exec', command: 'rg abcdef test.md' }),
    ];
    const { container, rerender } = render(<WorkedForDetails activities={activities} />);
    const group = container.querySelector('.worked-tool-group')!;

    expect(within(group.querySelector('summary')!).getByText('Run rg abcdef test.md')).toBeVisible();
    expect(within(group.querySelector('.worked-tool-group-items')!).getByText('Ran Get-Content test.md')).toBeInTheDocument();

    rerender(<WorkedForDetails activities={[...activities,
      toolActivity('second-complete', 'shell.exec completed.', { actionId: 'second', toolName: 'shell.exec', status: 'completed' }),
    ]} />);
    expect(within(container.querySelector('summary')!).getByText('Ran commands')).toBeVisible();
    expect(container.querySelectorAll('.worked-tool-terminal-icon')).toHaveLength(3);
  });
});
