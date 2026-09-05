import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Blocks, Brain, CreditCard, Info, KeyRound, Keyboard, MonitorCog, Plug, Puzzle, RefreshCw, ShieldCheck, UserRound, Workflow, Globe2, Settings2, Laptop } from 'lucide-react';
import type { UserProfile } from '../../../contracts/ipc/v1/auth.js';
import type { Workspace } from '../../../contracts/ipc/v1/workspace.js';
import { Scrollbar } from '../../components/Scrollbar.js';
import { Button, Icon, IconButton } from '../../components/ui.js';
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
import { MemorySettingsPage } from './MemorySettingsPage.js';
import { AboutPage } from './AboutPage.js';
import { PluginsPage } from './PluginsPage.js';
import { Breadcrumb } from '../../components/Breadcrumb.js';
import { ComputerUseSettingsPage } from './ComputerUseSettingsPage.js';

export type SettingsSection = 'general' | 'profile' | 'api-key' | 'billing' | 'appearance' | 'keyboard-shortcuts' | 'browser' | 'computer-use' | 'sandbox' | 'memory' | 'about' | ExtensionKind;
const settingsGroups: Array<{ title: string; items: Array<{ value: SettingsSection; label: string; icon: typeof UserRound }> }> = [
  { title: 'Account', items: [{ value: 'general', label: 'General', icon: Settings2 }, { value: 'profile', label: 'Profile', icon: UserRound }, { value: 'api-key', label: 'API key', icon: KeyRound }, { value: 'billing', label: 'Billing', icon: CreditCard }] },
  { title: 'Preferences', items: [{ value: 'appearance', label: 'Appearance', icon: MonitorCog }, { value: 'keyboard-shortcuts', label: 'Keyboard shortcuts', icon: Keyboard }] },
  { title: 'Runtime', items: [{ value: 'browser', label: 'Browser', icon: Globe2 }, { value: 'sandbox', label: 'Sandbox', icon: ShieldCheck }, { value: 'memory', label: 'Memory', icon: Brain }] },
  { title: 'Integrations', items: [{ value: 'computer-use', label: 'Computer Use', icon: Laptop }] },
  { title: 'Extensions', items: [{ value: 'hook', label: 'Hooks', icon: Workflow }, { value: 'skill', label: 'Skills', icon: Puzzle }, { value: 'plugin', label: 'Plugins', icon: Blocks }, { value: 'mcp', label: 'MCP', icon: Plug }] },
  { title: 'About', items: [{ value: 'about', label: 'About', icon: Info }] },
];

export function SettingsPage({ user, workspace, onBack, keyboardShortcuts, onUpdateShortcut, initialSection = 'profile' }: { user: UserProfile; workspace?: Workspace; onBack: () => void; keyboardShortcuts: KeyboardShortcutBindings; onUpdateShortcut: (action: KeyboardShortcutAction, shortcut: string | null) => Promise<void>; initialSection?: SettingsSection }) {
  const [section, setSection] = useState<SettingsSection>(initialSection);
  const [pluginDetailName, setPluginDetailName] = useState<string>();
  const [pluginDetailResetToken, setPluginDetailResetToken] = useState(0);
  const [memoryRefreshToken, setMemoryRefreshToken] = useState(0);
  useEffect(() => setSection(initialSection), [initialSection]);
  const accountName = user.fullName ?? user.username ?? user.email;
  const organizationCode = useMemo(() => user.defaultOrganizationCode ?? user.organizations[0]?.organizationCode, [user]);
  const navigateBreadcrumb = (path: string) => { const target = path.split('/').pop(); if (target === 'settings') { setPluginDetailName(undefined); setPluginDetailResetToken(current => current + 1); setSection('profile'); return; } if (target !== undefined && isSettingsSection(target)) { setPluginDetailName(undefined); setPluginDetailResetToken(current => current + 1); setSection(target); } };
  const breadcrumbPath = section === 'plugin' && pluginDetailName !== undefined ? `settings/plugin/${pluginDetailName}` : `settings/${section}`;
  return <div className="settings-page">
    <aside className="settings-sidebar"><Button variant="ghost" className="settings-back" onClick={onBack}><Icon icon={ArrowLeft} size={16} /> Back to app</Button><h2>Settings</h2><Scrollbar className="settings-nav scrollbar-hide-track"><div className="settings-nav-groups">{settingsGroups.map(group => <section className="settings-nav-group" key={group.title}><h3>{group.title}</h3><div className="settings-nav-list">{group.items.map(item => <button key={item.value} className={section === item.value ? 'settings-nav-item selected' : 'settings-nav-item'} onClick={() => setSection(item.value)}><Icon icon={item.icon} size={15} /> {item.label}</button>)}</div></section>)}</div></Scrollbar></aside>
    <Scrollbar className="settings-content-scrollbar"><main className="settings-content"><header className="settings-header"><Breadcrumb path={breadcrumbPath} currentHeading onNavigate={navigateBreadcrumb} {...(pluginDetailName === undefined ? {} : { labels: { [pluginDetailName]: pluginDetailName } })} />{section === 'memory' ? <IconButton icon={RefreshCw} iconSize={15} label="Refresh memory" disabled={workspace?.rootPath === undefined} onClick={() => setMemoryRefreshToken(current => current + 1)} /> : null}</header>{section === 'general' ? <GeneralSettingsPage /> : section === 'profile' ? <ProfilePanel user={user} accountName={accountName} /> : section === 'api-key' ? <ApiKeySettingsPage {...(workspace?.rootPath ? { cwd: workspace.rootPath } : {})} /> : section === 'billing' ? <BillingPanel {...(organizationCode ? { organizationCode } : {})} /> : section === 'appearance' ? <AppearancePage /> : section === 'keyboard-shortcuts' ? <KeyboardShortcutsPage bindings={keyboardShortcuts} onUpdate={onUpdateShortcut} /> : section === 'browser' ? <BrowserSettingsPage /> : section === 'computer-use' ? <ComputerUseSettingsPage /> : section === 'sandbox' ? <SandboxSettingsPage /> : section === 'memory' ? <MemorySettingsPage refreshToken={memoryRefreshToken} {...(workspace?.rootPath ? { cwd: workspace.rootPath } : {})} /> : section === 'about' ? <AboutPage /> : section === 'plugin' ? <PluginsPage {...(workspace?.rootPath ? { cwd: workspace.rootPath } : {})} trusted={workspace?.trusted === true} detailResetToken={pluginDetailResetToken} onDetailChange={setPluginDetailName} /> : <ExtensionsPage kind={section} {...(workspace?.rootPath ? { cwd: workspace.rootPath } : {})} trusted={workspace?.trusted === true} />}</main></Scrollbar>
  </div>;
}

function isSettingsSection(value: string): value is SettingsSection {
  return settingsGroups.some(group => group.items.some(item => item.value === value));
}
