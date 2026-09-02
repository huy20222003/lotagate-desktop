import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Blocks, CreditCard, KeyRound, Keyboard, MonitorCog, Plug, Puzzle, ShieldCheck, UserRound, Workflow, Globe2, Settings2 } from 'lucide-react';
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
import { BrowserSettingsPage } from './BrowserSettingsPage.js';
import { SandboxSettingsPage } from './SandboxSettingsPage.js';
import { ApiKeySettingsPage } from './ApiKeySettingsPage.js';
import { GeneralSettingsPage } from './GeneralSettingsPage.js';
import type { McpRuntimeStatus } from '../../services/mcp-status.js';

export type SettingsSection = 'general' | 'profile' | 'api-key' | 'billing' | 'appearance' | 'keyboard-shortcuts' | 'browser' | 'sandbox' | ExtensionKind;
const settingsGroups: Array<{ title: string; items: Array<{ value: SettingsSection; label: string; icon: typeof UserRound }> }> = [
  { title: 'Account', items: [{ value: 'general', label: 'General', icon: Settings2 }, { value: 'profile', label: 'Profile', icon: UserRound }, { value: 'api-key', label: 'API key', icon: KeyRound }, { value: 'billing', label: 'Billing', icon: CreditCard }] },
  { title: 'Preferences', items: [{ value: 'appearance', label: 'Appearance', icon: MonitorCog }, { value: 'keyboard-shortcuts', label: 'Keyboard shortcuts', icon: Keyboard }] },
  { title: 'Runtime', items: [{ value: 'browser', label: 'Browser', icon: Globe2 }, { value: 'sandbox', label: 'Sandbox', icon: ShieldCheck }] },
  { title: 'Extensions', items: [{ value: 'hook', label: 'Hooks', icon: Workflow }, { value: 'skill', label: 'Skills', icon: Puzzle }, { value: 'plugin', label: 'Plugins', icon: Blocks }, { value: 'mcp', label: 'MCP', icon: Plug }] },
];

export function SettingsPage({ user, workspace, mcpStatuses = {}, onBack, keyboardShortcuts, onUpdateShortcut, initialSection = 'profile' }: { user: UserProfile; workspace?: Workspace; mcpStatuses?: Record<string, McpRuntimeStatus>; onBack: () => void; keyboardShortcuts: KeyboardShortcutBindings; onUpdateShortcut: (action: KeyboardShortcutAction, shortcut: string | null) => Promise<void>; initialSection?: SettingsSection }) {
  const [section, setSection] = useState<SettingsSection>(initialSection);
  useEffect(() => setSection(initialSection), [initialSection]);
  const accountName = user.fullName ?? user.username ?? user.email;
  const organizationCode = useMemo(() => user.defaultOrganizationCode ?? user.organizations[0]?.organizationCode, [user]);
  const title = settingsGroups.flatMap(group => group.items).find(item => item.value === section)?.label ?? 'Settings';
  return <div className="settings-page">
    <aside className="settings-sidebar"><Button variant="ghost" className="settings-back" onClick={onBack}><Icon icon={ArrowLeft} size={16} /> Back to app</Button><h2>Settings</h2><Scrollbar className="settings-nav scrollbar-hide-track"><div className="settings-nav-groups">{settingsGroups.map(group => <section className="settings-nav-group" key={group.title}><h3>{group.title}</h3><div className="settings-nav-list">{group.items.map(item => <button key={item.value} className={section === item.value ? 'settings-nav-item selected' : 'settings-nav-item'} onClick={() => setSection(item.value)}><Icon icon={item.icon} size={15} /> {item.label}</button>)}</div></section>)}</div></Scrollbar></aside>
    <Scrollbar className="settings-content-scrollbar"><main className="settings-content"><header className="settings-header"><h1>{title}</h1></header>{section === 'general' ? <GeneralSettingsPage /> : section === 'profile' ? <ProfilePanel user={user} accountName={accountName} /> : section === 'api-key' ? <ApiKeySettingsPage {...(workspace?.rootPath ? { cwd: workspace.rootPath } : {})} /> : section === 'billing' ? <BillingPanel {...(organizationCode ? { organizationCode } : {})} /> : section === 'appearance' ? <AppearancePage /> : section === 'keyboard-shortcuts' ? <KeyboardShortcutsPage bindings={keyboardShortcuts} onUpdate={onUpdateShortcut} /> : section === 'browser' ? <BrowserSettingsPage /> : section === 'sandbox' ? <SandboxSettingsPage /> : <ExtensionsPage kind={section} {...(workspace?.rootPath ? { cwd: workspace.rootPath } : {})} trusted={workspace?.trusted === true} mcpStatuses={mcpStatuses} />}</main></Scrollbar>
  </div>;
}
