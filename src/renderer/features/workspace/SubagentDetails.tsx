import type { SubagentSnapshot } from '../../../contracts/ipc/v1/workspace.js';

export function SubagentDetails({ subagent }: { subagent: SubagentSnapshot }) {
  return <div className="subagent-details"><div className="subagent-detail-status"><span className={`subagent-status subagent-status-${subagent.status}`}>{subagent.status.replaceAll('_', ' ')}</span><span>{subagent.model}</span></div><p>{subagent.task}</p>{subagent.lastAction ? <small>{subagent.lastAction.label}</small> : null}{subagent.summary ? <small>{subagent.summary}</small> : null}{subagent.handoff ? <div className="subagent-handoff"><span>{subagent.handoff.filesInspected.length} files inspected</span><span>{subagent.handoff.filesChanged.length} files changed</span><span>{subagent.handoff.commandsRun.length} commands</span></div> : null}</div>;
}
