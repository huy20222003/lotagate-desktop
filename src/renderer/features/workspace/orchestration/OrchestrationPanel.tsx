import { Bot, LoaderCircle, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { SubagentSnapshot } from '../../../../contracts/ipc/v1/workspace.js';
import { OrchestrationDrawer } from '../../../components/OrchestrationDrawer.js';
import { SubagentDetails } from './SubagentDetails.js';
import { activeSubagentActivity, activeSubagents } from './subagent-display.js';
import { Icon, Tooltip } from '../../../components/ui.js';

export function OrchestrationPanel({ subagents }: { subagents: SubagentSnapshot[] }) {
  const active = activeSubagents(subagents);
  const [drawer, setDrawer] = useState<string | undefined>();
  const selectedSubagent = drawer === undefined ? undefined : subagents.find(subagent => subagent.id === drawer);
  const activity = activeSubagentActivity(subagents);
  useEffect(() => {
    if (drawer !== undefined && selectedSubagent === undefined) setDrawer(undefined);
  }, [drawer, selectedSubagent]);
  if (active.length === 0 && selectedSubagent === undefined) return null;
  return <>
    {active.length > 0 ? <section className="orchestration-panel" aria-label="Agent orchestration">
      {activity ? <div className="orchestration-activity" aria-live="polite"><Icon icon={activity.state === 'queued' ? LoaderCircle : Bot} size={14} {...(activity.state === 'queued' ? { className: 'spin' } : {})} /><span>{activity.label}</span></div> : null}
      <div className="orchestration-toolbar">
        {active.map(subagent => <Tooltip key={subagent.id} label={subagent.displayName}><button type="button" className={`subagent-chip ${drawer === subagent.id ? 'selected' : ''}`} aria-label={`Open ${subagent.displayName}`} onClick={() => setDrawer(current => current === subagent.id ? undefined : subagent.id)}><Icon icon={Bot} size={15} /><span className={`subagent-chip-status subagent-chip-status-${subagent.status}`} /></button></Tooltip>)}
      </div>
    </section> : null}
    {selectedSubagent ? <OrchestrationDrawer title={selectedSubagent.displayName} closeIcon={X} onClose={() => setDrawer(undefined)}><SubagentDetails subagent={selectedSubagent} /></OrchestrationDrawer> : null}
  </>;
}
