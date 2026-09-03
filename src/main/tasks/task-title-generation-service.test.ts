import { describe, expect, it, vi } from 'vitest';
import type { DesktopEvent } from '../../contracts/agent-protocol/v1/desktop.js';
import type { Task } from '../../contracts/ipc/v1/workspace.js';
import type { DesktopLogger } from '../observability/desktop-logger.js';
import type { AgentManager } from '../agents/agent-manager.js';
import type { TaskStore } from './task-store.js';
import { TaskTitleGenerationService } from './task-title-generation-service.js';

const completedEvent: DesktopEvent = { version: 3, type: 'event', scope: 'session', event: 'turn.completed', data: { sessionId: 'session-1', turnId: 'turn-1' } };

function task(overrides: Partial<Task> = {}): Task {
  return { id: 'task-1', workspaceId: 'workspace-1', title: 'Initial title', titleSource: 'automatic', titleSummaryStatus: 'not_started', cwd: 'C:\\workspace', status: 'completed', sessionId: 'session-1', pinned: false, archived: false, draft: '', draftAttachmentIds: [], lastEventCursor: 0, createdAt: '2026-09-02T00:00:00.000Z', updatedAt: '2026-09-02T00:00:00.000Z', ...overrides };
}

function createService(prompt: string, generatedTitle: string | undefined = 'Fix the session title generation flow', overrides: Partial<Task> = {}) {
  const current = task(overrides);
  const updated = task({ title: generatedTitle ?? current.title, titleSummaryStatus: 'completed' });
  const tasks = {
    findBySession: vi.fn().mockResolvedValue(current),
    activities: vi.fn().mockResolvedValue([{ id: 'activity-1', taskId: current.id, kind: 'user', text: prompt, metadata: {}, createdAt: current.createdAt }]),
    claimAutomaticTitleSummary: vi.fn().mockResolvedValue(current),
    completeAutomaticTitleSummary: vi.fn().mockResolvedValue(updated),
    failAutomaticTitleSummary: vi.fn().mockResolvedValue(undefined),
  } as unknown as TaskStore;
  const agents = { generateTitle: vi.fn().mockResolvedValue({ title: generatedTitle }) } as unknown as AgentManager;
  const logger = { warn: vi.fn() } as unknown as DesktopLogger;
  return { service: new TaskTitleGenerationService(tasks, agents, logger), tasks, agents };
}

describe('TaskTitleGenerationService', () => {
  it('sends only the first 100 words to the title model', async () => {
    const prompt = Array.from({ length: 140 }, (_, index) => `word-${index}`).join(' ');
    const { service, agents } = createService(prompt);

    await service.observeTurnCompleted('C:\\workspace', completedEvent);

    const sentPrompt = (agents.generateTitle as ReturnType<typeof vi.fn>).mock.calls[0]?.[1].prompt as string;
    expect(sentPrompt.split(/\s+/u)).toHaveLength(100);
    expect(sentPrompt).toBe(Array.from({ length: 100 }, (_, index) => `word-${index}`).join(' '));
  });

  it('does not generate a title when the task was manually renamed', async () => {
    const { service, agents, tasks } = createService('Keep my custom name', 'Should not be used', { titleSource: 'manual', titleSummaryStatus: 'completed' });

    await service.observeTurnCompleted('C:\\workspace', completedEvent);

    expect(agents.generateTitle).not.toHaveBeenCalled();
    expect(tasks.claimAutomaticTitleSummary).not.toHaveBeenCalled();
  });

  it('normalizes a verbose model title to the ten-word limit', async () => {
    const { service, tasks, agents } = createService('Summarize this request', 'one two three four five six seven eight nine ten eleven');

    await service.observeTurnCompleted('C:\\workspace', completedEvent);

    expect(agents.generateTitle).toHaveBeenCalledOnce();
    expect(tasks.failAutomaticTitleSummary).not.toHaveBeenCalled();
    expect(tasks.completeAutomaticTitleSummary).toHaveBeenCalledWith('task-1', 'one two three four five six seven eight nine ten');
  });

  it('normalizes a prefixed or JSON title response', async () => {
    const { service, tasks } = createService('Summarize this request', '{"title":"Title: **Tóm tắt yêu cầu của phiên làm việc**"}');

    await service.observeTurnCompleted('C:\\workspace', completedEvent);

    expect(tasks.completeAutomaticTitleSummary).toHaveBeenCalledWith('task-1', 'Tóm tắt yêu cầu của phiên làm việc');
  });
});
