import type { Workspace } from '../../../../contracts/ipc/v1/workspace.js';
import { Scrollbar } from '../../../components/Scrollbar.js';
import { AutomationCenter } from '../../automation/AutomationCenter.js';

export function WorkspaceAutomationPage({ workspaces }: { workspaces: Workspace[] }) {
  return <div className="automation-workspace-page">
    <header className="automation-workspace-header">
      <div className="automation-workspace-title"><span className="settings-eyebrow">Workflows</span><h1>Automations</h1></div>
    </header>
    <Scrollbar className="automation-workspace-scrollbar"><AutomationCenter workspaces={workspaces} /></Scrollbar>
  </div>;
}
