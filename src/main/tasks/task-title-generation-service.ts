import type { DesktopEvent } from '../../contracts/agent-protocol/v1/desktop.js';
import { takeWords } from '../../shared/text.js';
import type { DesktopLogger } from '../observability/desktop-logger.js';
import type { AgentManager } from '../agents/agent-manager.js';
import type { TaskStore } from './task-store.js';
import type { Task } from '../../contracts/ipc/v1/workspace.js';

const SUMMARY_INPUT_WORD_LIMIT = 100;
const SUMMARY_TITLE_WORD_LIMIT = 10;
const SUMMARY_TITLE_CHARACTER_LIMIT = 120;

export class TaskTitleGenerationService {
  private readonly inFlight = new Set<string>();

  constructor(private readonly tasks: TaskStore, private readonly agents: AgentManager, private readonly logger: DesktopLogger) {}

  async observeTurnCompleted(cwd: string, event: DesktopEvent): Promise<Task | undefined> {
    if (event.event !== 'turn.completed') return undefined;
    const sessionId = readString(event.data['sessionId']);
    if (sessionId === undefined) return undefined;
    const task = await this.tasks.findBySession(sessionId);
    if (task === undefined || task.titleSource !== 'automatic' || task.titleSummaryStatus !== 'not_started' || this.inFlight.has(task.id)) return undefined;
    const userActivities = (await this.tasks.activities(task.id)).filter(activity => activity.kind === 'user');
    const userPrompt = userActivities[0]?.text;
    if (userPrompt === undefined || userActivities.length !== 1) return undefined;
    const claimed = await this.tasks.claimAutomaticTitleSummary(task.id);
    if (claimed === undefined) return undefined;
    this.inFlight.add(claimed.id);
    try {
      const excerpt = takeWords(SUMMARY_INPUT_WORD_LIMIT, userPrompt);
      const result = await this.agents.generateTitle(cwd, { prompt: excerpt, ...(claimed.model === undefined ? {} : { model: claimed.model }) });
      const title = parseTitle(result);
      if (title === undefined) throw new Error('The title model returned an invalid session title.');
      return await this.tasks.completeAutomaticTitleSummary(claimed.id, title);
    } catch (error) {
      await this.tasks.failAutomaticTitleSummary(claimed.id).catch(failure => this.logger.warn('task.title.summary.state.failed', { taskId: claimed.id, message: failure instanceof Error ? failure.message : 'Unable to mark title summary as failed.' }));
      this.logger.warn('task.title.summary.failed', { taskId: claimed.id, message: error instanceof Error ? error.message : 'Unable to generate a session title.' });
      return undefined;
    } finally {
      this.inFlight.delete(claimed.id);
    }
  }
}

function parseTitle(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const raw = (value as Record<string, unknown>)['title'];
  if (typeof raw !== 'string') return undefined;
  const normalized = normalizeTitle(raw);
  const words = normalized.split(' ').filter(Boolean).slice(0, SUMMARY_TITLE_WORD_LIMIT);
  while (words.length > 0 && words.join(' ').length > SUMMARY_TITLE_CHARACTER_LIMIT) words.pop();
  return words.join(' ').trim() || undefined;
}

function normalizeTitle(raw: string): string {
  const firstLine = raw.split(/\r?\n/gu).map(line => line.trim()).find(Boolean) ?? '';
  const jsonTitle = readJsonTitle(firstLine);
  const source = jsonTitle ?? firstLine;
  return source
    .replace(/^(?:title|session title)\s*:\s*/iu, '')
    .replace(/^[-*•]\s*/u, '')
    .replace(/^[`*_#"“”‘’]+|[`*_#"“”‘’]+$/gu, '')
    .replace(/\s+/gu, ' ')
    .trim();
}

function readJsonTitle(value: string): string | undefined {
  if (!value.startsWith('{') || !value.endsWith('}')) return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    const title = typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>)['title'] : undefined;
    return typeof title === 'string' ? title : undefined;
  } catch {
    return undefined;
  }
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
