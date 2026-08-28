import { useMemo, useState } from 'react';
import { ArrowLeft, Blocks, Clock3, CreditCard, Keyboard, MonitorCog, Plug, Puzzle, UserRound, Workflow } from 'lucide-react';
import type { UserProfile } from '../../../contracts/ipc/v1/auth.js';
import type { Workspace } from '../../../contracts/ipc/v1/workspace.js';
import { Scrollbar } from '../../components/Scrollbar.js';
import { Button, Icon } from '../../components/ui.js';
import { ExtensionsPage } from './ExtensionsPage.js';
import type { ExtensionKind } from './extension-command-client.js';
import { AppearancePage } from './AppearancePage.js';
import { KeyboardShortcutsPage } from './KeyboardShortcutsPage.js';
import type { KeyboardShortcutAction, KeyboardShortcutBindings } from '../../services/keyboard-shortcuts.js';
import { ProfilePanel } from './ProfilePanel.js';
import { BillingPanel } from './BillingPanel.js';
import { AutomationCenter } from './AutomationCenter.js';

export type SettingsSection = 'profile' | 'billing' | 'appearance' | 'keyboard-shortcuts' | 'automation' | ExtensionKind;
const settingsGroups: Array<{ title: string; items: Array<{ value: SettingsSection; label: string; icon: typeof UserRound }> }> = [
  { title: 'Account', items: [{ value: 'profile', label: 'Profile', icon: UserRound }, { value: 'billing', label: 'Billing', icon: CreditCard }] },
  { title: 'Preferences', items: [{ value: 'appearance', label: 'Appearance', icon: MonitorCog }, { value: 'keyboard-shortcuts', label: 'Keyboard shortcuts', icon: Keyboard }] },
  { title: 'Workflows', items: [{ value: 'automation', label: 'Automations', icon: Clock3 }] },
  { title: 'Extensions', items: [{ value: 'hook', label: 'Hooks', icon: Workflow }, { value: 'skill', label: 'Skills', icon: Puzzle }, { value: 'plugin', label: 'Plugins', icon: Blocks }, { value: 'mcp', label: 'MCP', icon: Plug }] },
];

export function SettingsPage({ user, workspace, workspaces, onBack, keyboardShortcuts, onUpdateShortcut, initialSection = 'profile' }: { user: UserProfile; workspace?: Workspace; workspaces: Workspace[]; onBack: () => void; keyboardShortcuts: KeyboardShortcutBindings; onUpdateShortcut: (action: KeyboardShortcutAction, shortcut: string | null) => Promise<void>; initialSection?: SettingsSection }) {
  const [section, setSection] = useState<SettingsSection>(initialSection);
  const accountName = user.fullName ?? user.username ?? user.email;
  const organizationCode = useMemo(() => user.defaultOrganizationCode ?? user.organizations[0]?.organizationCode, [user]);
  const title = settingsGroups.flatMap(group => group.items).find(item => item.value === section)?.label ?? 'Settings';
  return <div className="settings-page">
    <aside className="settings-sidebar"><Button variant="ghost" className="settings-back" onClick={onBack}><Icon icon={ArrowLeft} size={16} /> Back to app</Button><h2>Settings</h2><Scrollbar className="settings-nav"><div className="settings-nav-groups">{settingsGroups.map(group => <section className="settings-nav-group" key={group.title}><h3>{group.title}</h3><div className="settings-nav-list">{group.items.map(item => <button key={item.value} className={section === item.value ? 'settings-nav-item selected' : 'settings-nav-item'} onClick={() => setSection(item.value)}><Icon icon={item.icon} size={15} /> {item.label}</button>)}</div></section>)}</div></Scrollbar></aside>
    <Scrollbar className="settings-content-scrollbar"><main className="settings-content"><header className="settings-header"><h1>{title}</h1></header>{section === 'profile' ? <ProfilePanel user={user} accountName={accountName} /> : section === 'billing' ? <BillingPanel {...(organizationCode ? { organizationCode } : {})} /> : section === 'appearance' ? <AppearancePage /> : section === 'keyboard-shortcuts' ? <KeyboardShortcutsPage bindings={keyboardShortcuts} onUpdate={onUpdateShortcut} /> : section === 'automation' ? <AutomationCenter workspaces={workspaces} /> : <ExtensionsPage kind={section} {...(workspace?.rootPath ? { cwd: workspace.rootPath } : {})} trusted={workspace?.trusted === true} />}</main></Scrollbar>
  </div>;
}
