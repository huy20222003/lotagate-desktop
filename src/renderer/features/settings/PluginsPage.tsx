import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Blocks, Bot, Download, ExternalLink, PackageOpen, Plug, Plus, Puzzle, Search, Trash2, Workflow } from 'lucide-react';
import { ActionMenu, type ActionMenuItem } from '../../components/ActionMenu.js';
import { Badge, Button, Card, EmptyState, Icon, IconButton, Tabs, TextInput, useToast } from '../../components/ui.js';
import { Pagination } from '../../components/Pagination.js';
import type { ExtensionDetail } from '../../../contracts/ipc/v1/extensions.js';
import { toUserErrorMessage as toMessage } from '../../utils/errors.js';
import { formatTextClamp } from '../../utils/text.js';
import { ExtensionAddModal } from './ExtensionAddModal.js';
import { ExtensionDetailModal } from './ExtensionDetailModal.js';
import type { ExtensionAddValue } from './extensions-view-types.js';
import { ExtensionCommandClient, type ExtensionRow, type PluginContribution, type PluginDetail } from './extension-command-client.js';
import type { PublicPluginCatalogEntry } from '../../../contracts/ipc/v1/extensions.js';

type PluginSource = { name: string; version: string; description: string; icon?: string | undefined; scope?: 'user' | 'project' | undefined; author?: string | undefined; license?: string | undefined; homepage?: string | undefined; privacyPolicy?: string | undefined; termsOfService?: string | undefined };
type SelectedPlugin = { source: PluginSource; detail?: PluginDetail; onInstall?: () => void; publicPluginDirectory?: string };

const CONTRIBUTION_META = {
  skill: { label: 'Skills', icon: Puzzle },
  mcp: { label: 'MCP', icon: Plug },
  hook: { label: 'Hooks', icon: Workflow },
  agent: { label: 'Agents', icon: Bot },
} as const;
const PLUGINS_PAGE_SIZE = 40;

export function PluginsPage({ cwd, trusted = false, detailResetToken, onDetailChange }: { cwd?: string; trusted?: boolean; detailResetToken?: number; onDetailChange?: (pluginName: string | undefined) => void }) {
  const client = useMemo(() => new ExtensionCommandClient(), []);
  const [tab, setTab] = useState('public');
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState<ExtensionRow[]>([]);
  const [loading, setLoading] = useState(Boolean(cwd));
  const [publicCatalog, setPublicCatalog] = useState<PublicPluginCatalogEntry[]>([]);
  const [publicLoading, setPublicLoading] = useState(true);
  const [selected, setSelected] = useState<SelectedPlugin>();
  const [addOpen, setAddOpen] = useState(false);
  const [busy, setBusy] = useState<string>();
  const [detailTarget, setDetailTarget] = useState<{ kind: 'skill' | 'mcp' | 'hook'; row: ExtensionRow; detail: ExtensionDetail }>();
  const { success, error: showError } = useToast();
  const requestRef = useRef(0);
  const publicRequestRef = useRef(0);
  useEffect(() => { onDetailChange?.(selected?.source.name); }, [onDetailChange, selected?.source.name]);
  useEffect(() => { if (detailResetToken !== undefined) setSelected(undefined); }, [detailResetToken]);

  const loadPublicPlugins = useCallback(async () => {
    const requestId = ++publicRequestRef.current;
    setPublicLoading(true);
    try {
      const nextPlugins = await window.lotagate.extensions.listPublicPlugins();
      if (publicRequestRef.current === requestId) setPublicCatalog([...nextPlugins]);
    } catch (reason) {
      if (publicRequestRef.current === requestId) {
        setPublicCatalog([]);
        showError('Unable to load public plugins', toMessage(reason));
      }
    } finally {
      if (publicRequestRef.current === requestId) setPublicLoading(false);
    }
  }, [showError]);
  useEffect(() => { void loadPublicPlugins(); }, [loadPublicPlugins]);

  const reload = useCallback(async () => {
    const requestId = ++requestRef.current;
    if (!cwd) { setRows([]); setLoading(false); return; }
    setLoading(true);
    try {
      const actions = await client.listCommands(cwd);
      if (trusted && actions.has('trust.grant')) await client.execute(cwd, { actionId: 'trust.grant', positionals: [], options: {} });
      const nextRows = await client.list(cwd, 'plugin');
      if (requestRef.current === requestId) setRows(nextRows);
    } catch (reason) {
      if (requestRef.current === requestId) showError('Unable to load plugins', toMessage(reason));
    } finally {
      if (requestRef.current === requestId) setLoading(false);
    }
  }, [client, cwd, showError, trusted]);
  useEffect(() => { void reload(); }, [reload]);

  const installed = useMemo(() => new Map(rows.map(row => [row.name, row])), [rows]);
  const query = search.trim().toLocaleLowerCase();
  const publicPluginNames = useMemo(() => new Set(publicCatalog.map(plugin => plugin.name)), [publicCatalog]);
  const publicPlugins = useMemo(() => publicCatalog.filter(plugin => !query || `${plugin.name} ${plugin.description} ${plugin.author ?? ''}`.toLocaleLowerCase().includes(query)), [publicCatalog, query]);
  const personalPlugins = useMemo(() => rows.filter(row => !publicPluginNames.has(row.name) && (!query || `${row.name} ${row.description ?? ''} ${row.detail}`.toLocaleLowerCase().includes(query))), [publicPluginNames, query, rows]);
  const [page, setPage] = useState(1);
  useEffect(() => { setPage(1); }, [query, tab]);
  const visiblePublicPlugins = useMemo(() => publicPlugins.slice((page - 1) * PLUGINS_PAGE_SIZE, page * PLUGINS_PAGE_SIZE), [page, publicPlugins]);
  const visiblePersonalPlugins = useMemo(() => personalPlugins.slice((page - 1) * PLUGINS_PAGE_SIZE, page * PLUGINS_PAGE_SIZE), [page, personalPlugins]);

  const execute = useCallback(async (invocation: { actionId: string; positionals: string[]; options: Record<string, string | boolean> }, message: string) => {
    if (!cwd) return false;
    const key = `${invocation.actionId}:${invocation.positionals.join(':')}`;
    setBusy(key);
    try {
      if (invocation.options['scope'] === 'project' && !trusted) throw new Error('Trust this workspace before changing project-scoped plugins.');
      await client.execute(cwd, invocation);
      success(message);
      await reload();
      return true;
    } catch (reason) {
      showError('Plugin operation failed', toMessage(reason));
      return false;
    } finally { setBusy(undefined); }
  }, [client, cwd, reload, showError, success, trusted]);

  const installPublic = useCallback(async (plugin: PublicPluginCatalogEntry): Promise<boolean> => {
    if (!cwd) return false;
    try {
      const source = await window.lotagate.extensions.resolvePublicPluginSource(plugin.directory);
      return await execute({ actionId: 'plugin.install', positionals: [source], options: { scope: 'user' } }, `Installed ${plugin.name}`);
    } catch (reason) {
      showError('Plugin operation failed', toMessage(reason));
      return false;
    }
  }, [cwd, execute, showError]);

  const openPlugin = useCallback(async (source: PluginSource) => {
    if (!cwd) return;
    const row = installed.get(source.name);
    if (row === undefined || (row.scope !== 'user' && row.scope !== 'project')) { setSelected({ source }); return; }
    setBusy(`open:${source.name}`);
    try { setSelected({ source, detail: await client.detail(cwd, source.name, row.scope) }); }
    catch (reason) { showError('Unable to open plugin', toMessage(reason)); }
    finally { setBusy(undefined); }
  }, [client, cwd, installed, showError]);

  const openPublicPlugin = useCallback((plugin: PublicPluginCatalogEntry) => {
    const source: PluginSource = { name: plugin.name, version: plugin.version, description: plugin.description, ...(plugin.icon === undefined ? {} : { icon: plugin.icon }), ...(plugin.author === undefined ? {} : { author: plugin.author }), ...(plugin.license === undefined ? {} : { license: plugin.license }), ...(plugin.homepage === undefined ? {} : { homepage: plugin.homepage }), ...(plugin.privacyPolicy === undefined ? {} : { privacyPolicy: plugin.privacyPolicy }), ...(plugin.termsOfService === undefined ? {} : { termsOfService: plugin.termsOfService }) };
    const row = installed.get(plugin.name);
    if (row?.scope === 'user' || row?.scope === 'project') {
      void openPlugin({ ...source, scope: row.scope });
      return;
    }
    const detail: PluginDetail = {
      plugin: { name: plugin.name, version: plugin.version, description: plugin.description, ...(plugin.author === undefined ? {} : { author: plugin.author }), ...(plugin.license === undefined ? {} : { license: plugin.license }), ...(plugin.homepage === undefined ? {} : { homepage: plugin.homepage }), scope: 'user', status: 'DISABLED' },
      contributions: plugin.contributions.map(contribution => ({ ...contribution, name: `${plugin.name}:${contribution.sourceName}`, status: 'DISABLED' as const })),
    };
    setSelected({ source, detail, publicPluginDirectory: plugin.directory, onInstall: () => { void installPublic(plugin).then(async done => { if (!done || !cwd) return; setBusy(`open:${plugin.name}`); try { const installedDetail = await client.detail(cwd, plugin.name, 'user'); setSelected({ source: { ...source, scope: 'user' }, detail: installedDetail }); } catch (reason) { showError('Unable to open installed plugin', toMessage(reason)); } finally { setBusy(undefined); } }); } });
  }, [client, cwd, installPublic, installed, openPlugin, showError]);

  const installOrUninstall = (plugin: PublicPluginCatalogEntry) => {
    const row = installed.get(plugin.name);
    if (row?.scope !== 'user' && row?.scope !== 'project') { void installPublic(plugin); return; }
    void execute({ actionId: 'plugin.uninstall', positionals: [plugin.name], options: { scope: row.scope } }, `Uninstalled ${plugin.name}`);
  };

  const installPersonal = (value: ExtensionAddValue) => { setAddOpen(false); void execute(value.invocation, value.message); };
  const uninstallSelected = () => {
    if (!selected?.detail || !cwd) return;
    void execute({ actionId: 'plugin.uninstall', positionals: [selected.detail.plugin.name], options: { scope: selected.detail.plugin.scope } }, `Uninstalled ${selected.detail.plugin.name}`).then(done => { if (done) setSelected(undefined); });
  };

  const openContribution = async (contribution: PluginContribution) => {
    if (!cwd || selected?.detail === undefined || contribution.kind === 'agent') return;
    const row: ExtensionRow = { name: contribution.name, status: contribution.status, detail: contribution.description, scope: 'plugin', pluginName: selected.detail.plugin.name, pluginScope: selected.detail.plugin.scope, sourceName: contribution.sourceName, editable: false };
    try {
      const detail = selected.publicPluginDirectory === undefined
        ? await window.lotagate.extensions.readDetail({ kind: contribution.kind, cwd, name: contribution.name, scope: 'plugin', pluginName: selected.detail.plugin.name, pluginScope: selected.detail.plugin.scope, sourceName: contribution.sourceName })
        : await window.lotagate.extensions.readPublicPluginContribution({ pluginName: selected.publicPluginDirectory, kind: contribution.kind, sourceName: contribution.sourceName });
      setDetailTarget({ kind: contribution.kind, row, detail });
    } catch (reason) { showError('Unable to open contribution', toMessage(reason)); }
  };

  const detailModal = detailTarget && cwd ? <ExtensionDetailModal kind={detailTarget.kind} cwd={cwd} row={detailTarget.row} detail={detailTarget.detail} onClose={() => setDetailTarget(undefined)} onSaved={() => setDetailTarget(undefined)} /> : null;
  if (selected !== undefined) return <><PluginDetailView selected={selected} cwd={cwd} busy={busy} onInstall={selected.onInstall} onUninstall={selected.detail !== undefined && selected.onInstall === undefined ? uninstallSelected : undefined} onOpenContribution={contribution => { void openContribution(contribution); }} />{detailModal}</>;
  return <div className="settings-plugins-page">
    <div className="settings-plugins-toolbar"><div className="settings-plugins-search"><Icon icon={Search} size={15} /><TextInput value={search} onChange={event => setSearch(event.target.value)} placeholder="Search plugins" aria-label="Search plugins" /></div>{tab === 'personal' ? <IconButton icon={Plus} iconSize={17} className="settings-extension-add" label="Install plugin" onClick={() => setAddOpen(true)} /> : null}</div>
    <Tabs value={tab} items={[{ value: 'public', label: 'Public' }, { value: 'personal', label: 'Personal' }]} onChange={setTab} ariaLabel="Plugin catalog" />
    {loading || publicLoading ? <div className="settings-plugin-grid">{[1, 2, 3, 4].map(item => <Card className="settings-plugin-card settings-plugin-card-loading" key={item}><span /><span /><span /></Card>)}</div> : tab === 'public' ? publicPlugins.length === 0 ? <EmptyState title={query ? 'No matching plugins' : 'No public plugins yet'} description={query ? 'Try a different search.' : 'Reviewed Desktop plugins will appear here when they are added to the public plugin folder.'} /> : <div className="settings-plugin-grid">{visiblePublicPlugins.map(plugin => <PluginCard key={plugin.name} cwd={cwd} plugin={{ name: plugin.name, version: plugin.version, description: plugin.description, ...(plugin.icon === undefined ? {} : { icon: plugin.icon }), ...(plugin.author === undefined ? {} : { author: plugin.author }) }} installed={installed.get(plugin.name)} busy={busy !== undefined} onOpen={() => { void openPublicPlugin(plugin); }} onAction={() => installOrUninstall(plugin)} />)}</div> : personalPlugins.length === 0 ? <EmptyState title={query ? 'No matching plugins' : 'No personal plugins installed'} description={query ? 'Try a different search.' : 'Install a plugin from a local path, Git repository, or npm package.'} /> : <div className="settings-plugin-grid">{visiblePersonalPlugins.map(row => <PluginCard key={`${row.scope}:${row.name}`} cwd={cwd} plugin={{ name: row.name, version: row.version ?? '', description: row.description ?? row.detail, scope: row.scope === 'user' || row.scope === 'project' ? row.scope : undefined }} installed={row} busy={busy !== undefined} onOpen={() => { void openPlugin({ name: row.name, version: row.version ?? '', description: row.description ?? row.detail, scope: row.scope === 'user' || row.scope === 'project' ? row.scope : undefined }); }} />)}</div>}
    {!loading && !publicLoading ? <Pagination page={page} pageSize={PLUGINS_PAGE_SIZE} total={tab === 'public' ? publicPlugins.length : personalPlugins.length} onPageChange={setPage} /> : null}
    {addOpen ? <ExtensionAddModal kind="plugin" busy={busy !== undefined} onClose={() => setAddOpen(false)} onSubmit={installPersonal} /> : null}
    {detailModal}
  </div>;
}

function PluginCard({ cwd, plugin, installed, busy, onOpen, onAction }: { cwd: string | undefined; plugin: PluginSource; installed: ExtensionRow | undefined; busy: boolean; onOpen: () => void; onAction?: () => void }) {
  const installedState = installed !== undefined;
  return <Card className="settings-plugin-card-wrap"><div className="settings-plugin-card" role="button" tabIndex={0} onClick={onOpen} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onOpen(); } }}><PluginIcon cwd={cwd} name={plugin.name} scope={plugin.scope} source={plugin.icon} /><span className="settings-plugin-card-copy"><strong>{plugin.name}</strong><span>{formatTextClamp(90, plugin.description)}</span></span><span className="settings-plugin-card-action">{onAction ? <Button type="button" disabled={busy} onClick={event => { event.stopPropagation(); onAction(); }}>{installedState ? 'Uninstall' : 'Install'}</Button> : <Badge tone={installed?.status === 'DISABLED' ? 'warning' : 'success'}>{installed?.status === 'DISABLED' ? 'Disabled' : 'Installed'}</Badge>}</span></div></Card>;
}

function PluginDetailView({ selected, cwd, busy, onInstall, onUninstall, onOpenContribution }: { selected: SelectedPlugin; cwd: string | undefined; busy: string | undefined; onInstall: (() => void) | undefined; onUninstall: (() => void) | undefined; onOpenContribution: (contribution: PluginContribution) => void }) {
  const detail = selected.detail;
  const source = selected.source;
  const metadata = detail?.plugin ?? { name: source.name, version: source.version, description: source.description, scope: source.scope ?? 'user', status: 'DISABLED' as const };
  const items = detail?.contributions ?? [];
  const menuItems: ActionMenuItem[] = onUninstall === undefined ? [] : [{ label: 'Uninstall plugin', icon: Trash2, tone: 'danger', disabled: busy !== undefined, onSelect: onUninstall }];
  const capabilities = [...new Set(items.map(item => CONTRIBUTION_META[item.kind].label))].join(', ');
  const information = [
    ...(capabilities.length === 0 ? [] : [{ label: 'Capabilities', value: capabilities }]),
    ...(metadata.author === undefined ? [] : [{ label: 'Developer', value: metadata.author }]),
    ...(metadata.license === undefined ? [] : [{ label: 'License', value: metadata.license }]),
    { label: 'Version', value: metadata.version },
    ...(source.homepage === undefined ? [] : [{ label: 'Website', href: source.homepage }]),
    ...(source.privacyPolicy === undefined ? [] : [{ label: 'Privacy Policy', href: source.privacyPolicy }]),
    ...(source.termsOfService === undefined ? [] : [{ label: 'Terms of Service', href: source.termsOfService }]),
  ];
  return <div className="settings-plugin-detail-page"><section className="settings-plugin-hero"><PluginIcon cwd={cwd} name={metadata.name} scope={metadata.scope} source={source.icon} size="hero" /><div className="settings-plugin-hero-copy"><div className="settings-plugin-kicker">{metadata.status === 'ENABLED' ? 'Installed plugin' : 'Public plugin'}</div><h2>{metadata.name}</h2><p>{metadata.description ?? 'No description provided.'}</p><small>Version {metadata.version}{metadata.author ? ` · ${metadata.author}` : ''}</small></div><div className="settings-plugin-hero-actions">{menuItems.length > 0 ? <ActionMenu items={menuItems} ariaLabel="Plugin actions" /> : onInstall ? <Button disabled={busy !== undefined} onClick={onInstall}><Download size={14} /> Install</Button> : null}</div></section>{(['skill', 'mcp', 'hook', 'agent'] as const).map(kind => { const contributionItems = items.filter(item => item.kind === kind); return contributionItems.length === 0 ? null : <section className="settings-plugin-contribution-section" key={kind}><div className="settings-plugin-section-heading"><h3>{CONTRIBUTION_META[kind].label}</h3><Badge>{contributionItems.length}</Badge></div><div className="settings-plugin-contribution-list">{contributionItems.map(item => <button type="button" className={kind === 'agent' ? 'settings-plugin-contribution is-static' : 'settings-plugin-contribution'} key={item.name} disabled={kind === 'agent'} onClick={() => onOpenContribution(item)}><Icon icon={CONTRIBUTION_META[kind].icon} size={17} /><span><strong>{item.sourceName}</strong><small>{formatTextClamp(120, item.description)}</small></span><span className="settings-plugin-contribution-status">{metadata.status === 'ENABLED' ? 'Active' : 'Inactive'}</span></button>)}</div></section>; })}{detail && items.length === 0 ? <EmptyState icon={PackageOpen} title="No contributions" description="This plugin does not declare skills, MCP servers, hooks, or agents." /> : null}<section className="settings-plugin-information"><div className="settings-plugin-section-heading"><h3>Information</h3></div><div className="settings-plugin-information-list">{information.map(item => <div className="settings-plugin-information-row" key={item.label}><span>{item.label}</span>{'href' in item ? <a href={item.href} target="_blank" rel="noreferrer" aria-label={`${item.label}: ${item.href}`}><ExternalLink size={14} /></a> : <strong>{item.value}</strong>}</div>)}</div></section></div>;
}

function PluginIcon({ cwd, name, scope, source, size = 'card' }: { cwd: string | undefined; name: string; scope: 'user' | 'project' | undefined; source: string | undefined; size?: 'card' | 'hero' }) {
  const [icon, setIcon] = useState(source);
  useEffect(() => {
    let active = true;
    if (source !== undefined || scope === undefined || typeof window === 'undefined') return () => { active = false; };
    if (cwd === undefined) return () => { active = false; };
    void window.lotagate.extensions.readPluginIcon({ cwd, name, scope }).then(value => { if (active && value) setIcon(`data:${value.mimeType};base64,${value.data}`); }).catch(() => undefined);
    return () => { active = false; };
  }, [cwd, name, scope, source]);
  return <span className={`settings-plugin-icon settings-plugin-icon-${size}`}>{icon ? <img src={icon} alt="" /> : <Icon icon={Blocks} size={size === 'hero' ? 31 : 20} />}</span>;
}
