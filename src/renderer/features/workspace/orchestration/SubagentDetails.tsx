import type { SubagentSnapshot } from '../../../../contracts/ipc/v1/workspace.js';
import { Terminal } from 'lucide-react';
import { formatTextClamp } from '../../../utils/text.js';

const SUBAGENT_TASK_PREVIEW_LENGTH = 300;

type ParsedHandoff = {
  summary?: string;
  filesInspected?: string[];
  filesChanged?: string[];
  commandsRun?: string[];
  verification?: string[];
  warnings?: string[];
};

function parseHandoff(value: string | undefined): ParsedHandoff | undefined {
  if (value === undefined) return undefined;
  for (const candidate of [value.trim(), ...extractJsonBlocks(value)]) {
    try {
      const parsed: unknown = JSON.parse(candidate);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) continue;
      const record = parsed as Record<string, unknown>;
      const knownKeys = ['summary', 'filesInspected', 'filesChanged', 'commandsRun', 'verification', 'warnings'] as const;
      if (!knownKeys.some(key => key in record)) continue;
      const arrays = (key: keyof Omit<ParsedHandoff, 'summary'>): string[] | undefined => {
        const item = record[key];
        return Array.isArray(item) && item.every(entry => typeof entry === 'string') ? item : undefined;
      };
      const result: ParsedHandoff = {};
      if (typeof record['summary'] === 'string') result.summary = record['summary'];
      for (const key of ['filesInspected', 'filesChanged', 'commandsRun', 'verification', 'warnings'] as const) {
        const array = arrays(key);
        if (array !== undefined) result[key] = array;
      }
      return result;
    } catch { /* Try the next complete JSON object in the value. */ }
  }
  return undefined;
}

function extractJsonBlocks(value: string): string[] {
  const blocks: string[] = [];
  for (let start = value.indexOf('{'); start >= 0; start = value.indexOf('{', start + 1)) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = start; index < value.length; index += 1) {
      const character = value[index];
      if (inString) {
        if (escaped) escaped = false;
        else if (character === '\\') escaped = true;
        else if (character === '"') inString = false;
        continue;
      }
      if (character === '"') inString = true;
      else if (character === '{') depth += 1;
      else if (character === '}' && --depth === 0) {
        blocks.push(value.slice(start, index + 1));
        break;
      }
    }
  }
  return blocks;
}

function firstDefined<T>(...values: Array<T | undefined>): T | undefined {
  return values.find(value => value !== undefined);
}

function resolveHandoff(subagent: SubagentSnapshot): { summary?: string; filesInspected: string[]; filesChanged: string[]; commandsRun: string[]; verification: string[]; warnings: string[] } | undefined {
  const parsed = parseHandoff(subagent.summary) ?? parseHandoff(subagent.handoff?.summary);
  const handoff = subagent.handoff;
  if (handoff === undefined && parsed === undefined) return undefined;
  const summary = firstDefined(parsed?.summary, handoff?.summary, subagent.summary);
  return {
    ...(summary === undefined ? {} : { summary }),
    filesInspected: parsed?.filesInspected ?? handoff?.filesInspected ?? [],
    filesChanged: parsed?.filesChanged ?? handoff?.filesChanged ?? [],
    commandsRun: parsed?.commandsRun ?? handoff?.commandsRun ?? [],
    verification: parsed?.verification ?? handoff?.verification ?? [],
    warnings: parsed?.warnings ?? handoff?.warnings ?? [],
  };
}

function actionState(subagent: SubagentSnapshot): 'running' | 'completed' | 'failed' {
  if (subagent.status === 'queued' || subagent.status === 'running') return 'running';
  if (subagent.status === 'failed' || subagent.status === 'cancelled') return 'failed';
  return 'completed';
}

export function SubagentDetails({ subagent }: { subagent: SubagentSnapshot }) {
  const handoff = resolveHandoff(subagent);
  const lastActionState = actionState(subagent);
  return <div className="subagent-details"><div className="subagent-detail-status"><span className={`subagent-status subagent-status-${subagent.status}`}>{subagent.status.replaceAll('_', ' ')}</span><span>{subagent.model}</span></div><p className="subagent-task"><strong>Task:</strong> {formatTextClamp(SUBAGENT_TASK_PREVIEW_LENGTH, subagent.task)}</p>{subagent.lastAction ? <section className="subagent-detail-section"><strong>Last action</strong><div className={`worked-tool worked-tool-${lastActionState}`}><Terminal className="worked-tool-icon worked-tool-terminal-icon" size={14} aria-hidden="true" /><span className={lastActionState === 'running' ? 'typing-label' : undefined} title={subagent.lastAction.label}>{subagent.lastAction.label}</span></div></section> : null}{handoff?.summary ? <section className="subagent-detail-section"><strong>Summary</strong><p>{handoff.summary}</p></section> : null}{handoff ? <div className="subagent-handoff" aria-label="Handoff details"><div><span>Files inspected</span><strong>{handoff.filesInspected.length}</strong></div><div><span>Files changed</span><strong>{handoff.filesChanged.length}</strong></div><div><span>Commands run</span><strong>{handoff.commandsRun.length}</strong></div></div> : null}{handoff?.verification.length ? <section className="subagent-detail-section"><strong>Verification</strong><ul>{handoff.verification.map(item => <li key={item}>{item}</li>)}</ul></section> : null}{handoff?.warnings.length ? <section className="subagent-detail-section subagent-detail-warnings"><strong>Warnings</strong><ul>{handoff.warnings.map(item => <li key={item}>{item}</li>)}</ul></section> : null}</div>;
}
