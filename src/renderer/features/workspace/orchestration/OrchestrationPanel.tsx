import { Bot, LoaderCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { SubagentSnapshot } from '../../../../contracts/ipc/v1/workspace.js';
import { OrchestrationDrawer } from '../../../components/OrchestrationDrawer.js';
import { SubagentDetails } from './SubagentDetails.js';
import { Icon, Tooltip } from '../../../components/ui.js';

export function OrchestrationPanel({ subagents }: { subagents: SubagentSnapshot[] }) {
  const activeSubagents = subagents.filter(subagent => subagent.status === 'queued' || subagent.status === 'running');
  const [drawer, setDrawer] = useState<string | undefined>();
  const selectedSubagent = drawer === undefined ? undefined : activeSubagents.find(subagent => subagent.id === drawer);
  useEffect(() => {
    if (drawer !== undefined && selectedSubagent === undefined) setDrawer(undefined);
  }, [drawer, selectedSubagent]);
  if (activeSubagents.length === 0) return null;
  const queued = activeSubagents.filter(subagent => subagent.status === 'queued');
  const createdLabel = activeSubagents.map(subagent => subagent.displayName).join(', ');
  return <>
    <section className="orchestration-panel" aria-label="Agent orchestration">
      {queued.length > 0 ? <div className="orchestration-activity" aria-live="polite"><Icon icon={LoaderCircle} size={14} className="spin" /><span>Create agent</span></div> : activeSubagents.length > 0 ? <div className="orchestration-activity" aria-live="polite"><Icon icon={Bot} size={14} /><span>Created agent {createdLabel}</span></div> : null}
      <div className="orchestration-toolbar">
        {activeSubagents.map(subagent => <Tooltip key={subagent.id} label={subagent.displayName}><button type="button" className={`subagent-chip ${drawer === subagent.id ? 'selected' : ''}`} aria-label={`Open ${subagent.displayName}`} onClick={() => setDrawer(current => current === subagent.id ? undefined : subagent.id)}><Icon icon={Bot} size={15} /><span className={`subagent-chip-status subagent-chip-status-${subagent.status}`} /></button></Tooltip>)}
      </div>
    </section>
    {selectedSubagent ? <OrchestrationDrawer title={selectedSubagent.displayName} onClose={() => setDrawer(undefined)}><SubagentDetails subagent={selectedSubagent} /></OrchestrationDrawer> : null}
  </>;
}
