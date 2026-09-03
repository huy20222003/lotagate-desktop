import { useEffect, useRef, useState } from 'react';
import { FolderOpen } from 'lucide-react';
import type { BrowserSettings } from '../../../contracts/ipc/v1/settings.js';
import { normalizeOriginAllowlist } from '../../../contracts/ipc/v1/origin-allowlist.js';
import { Button, Dropdown, Icon, TextArea, TextInput, useToast } from '../../components/ui.js';
import { SettingsPageSkeleton } from './SettingsPageSkeleton.js';

const defaults: BrowserSettings = { viewportProfile: 'desktop', customViewport: { width: 1_280, height: 800, mobile: false, deviceScaleFactor: 1 }, downloadDirectory: '', sessionRetention: 'persistent', sessionRetentionMinutes: 60, originAllowlist: [], clearDataOnClose: false, evidenceRetentionDays: 30 };
const viewportOptions = [{ value: 'desktop', label: 'Desktop · 1280 × 800' }, { value: 'laptop', label: 'Laptop · 1440 × 900' }, { value: 'tablet', label: 'Tablet · 1024 × 768' }, { value: 'mobile', label: 'Mobile · 390 × 844' }, { value: 'custom', label: 'Custom device profile' }];
const retentionOptions = [{ value: 'session', label: 'Session only' }, { value: 'persistent', label: 'Persistent profile' }, { value: 'ttl', label: 'Expire after timeout' }];

export function BrowserSettingsPage() {
  const [value, setValue] = useState<BrowserSettings>(defaults);
  const [loading, setLoading] = useState(true);
  const valueRef = useRef(value);
  const saveSequenceRef = useRef(0);
  const { error } = useToast();
  useEffect(() => { void window.lotagate.settings.get().then(settings => { valueRef.current = settings.browser; setValue(settings.browser); }).catch(reason => error('Unable to load Browser settings', reason instanceof Error ? reason.message : 'Please try again.')).finally(() => setLoading(false)); }, [error]);
  if (loading) return <SettingsPageSkeleton rows={5} />;
  const persist = async (next: BrowserSettings) => {
    const sequence = ++saveSequenceRef.current;
    try {
      const result = await window.lotagate.settings.update({ browser: next });
      if (sequence === saveSequenceRef.current) { valueRef.current = result.browser; setValue(result.browser); }
    } catch (reason) {
      error('Unable to save Browser settings', reason instanceof Error ? reason.message : 'Please try again.');
    }
  };
  const set = <K extends keyof BrowserSettings>(key: K, next: BrowserSettings[K]) => {
    const updated = { ...valueRef.current, [key]: next };
    valueRef.current = updated;
    setValue(updated);
    void persist(updated);
  };
  const chooseDownloadDirectory = async () => {
    try {
      const directory = await window.lotagate.workspaces.pickFolder();
      if (directory !== null) set('downloadDirectory', directory);
    } catch (reason) {
      error('Unable to choose download directory', reason instanceof Error ? reason.message : 'Please try again.');
    }
  };
  return <div className="appearance-page">
    <section className="appearance-section">
      <div className="appearance-section-heading"><div><h2>Browser</h2><p>Define the browser environment used by the agent and by manual Browser sessions. These defaults apply consistently to navigation, inspection, downloads, and evidence.</p></div><span className="settings-status">Desktop browser</span></div>
    </section>
    <section className="appearance-section appearance-settings-card">
      <div className="appearance-section-heading"><div><h2>Viewport & device</h2><p>Choose the screen profile that browser pages should render against.</p></div></div>
      <div className="appearance-setting-row"><div><strong>Viewport profile</strong><span>Choose the screen profile that browser pages should render against.</span></div><Dropdown ariaLabel="Viewport profile" value={value.viewportProfile} options={viewportOptions} onChange={next => set('viewportProfile', next as BrowserSettings['viewportProfile'])} /></div>
      {value.viewportProfile === 'custom' ? <>
        <div className="appearance-setting-row"><div><strong>Viewport width</strong><span>Set the custom browser viewport width in pixels.</span></div><TextInput aria-label="Viewport width (px)" type="number" min={320} max={3840} value={value.customViewport.width} onChange={event => set('customViewport', { ...value.customViewport, width: Number(event.target.value) })} /></div>
        <div className="appearance-setting-row"><div><strong>Viewport height</strong><span>Set the custom browser viewport height in pixels.</span></div><TextInput aria-label="Viewport height (px)" type="number" min={240} max={2160} value={value.customViewport.height} onChange={event => set('customViewport', { ...value.customViewport, height: Number(event.target.value) })} /></div>
        <div className="appearance-setting-row"><div><strong>Device scale factor</strong><span>Set the device pixel ratio for the custom profile.</span></div><TextInput aria-label="Device scale factor" type="number" min={1} max={4} step={0.25} value={value.customViewport.deviceScaleFactor} onChange={event => set('customViewport', { ...value.customViewport, deviceScaleFactor: Number(event.target.value) })} /></div>
        <div className="appearance-setting-row"><div><strong>Mobile device emulation</strong><span>Use mobile viewport behavior and touch-oriented page rendering.</span></div><label className="settings-toggle"><input type="checkbox" checked={value.customViewport.mobile} onChange={event => set('customViewport', { ...value.customViewport, mobile: event.target.checked })} /><span>Enabled</span></label></div>
      </> : null}
    </section>
    <section className="appearance-section appearance-settings-card">
      <div className="appearance-section-heading"><div><h2>Profile & downloads</h2><p>Control browser data lifetime and where downloaded files are written.</p></div></div>
      <div className="appearance-setting-row"><div><strong>Session retention</strong><span>Choose how long the browser profile remains available.</span></div><Dropdown ariaLabel="Session retention" value={value.sessionRetention} options={retentionOptions} onChange={next => set('sessionRetention', next as BrowserSettings['sessionRetention'])} /></div>
      {value.sessionRetention === 'ttl' ? <div className="appearance-setting-row"><div><strong>Retention timeout</strong><span>Expire the browser profile after this many minutes.</span></div><TextInput aria-label="Retention timeout (minutes)" type="number" min={1} max={10080} value={value.sessionRetentionMinutes} onChange={event => set('sessionRetentionMinutes', Number(event.target.value))} /></div> : null}
      <div className="appearance-setting-row"><div><strong>Download directory</strong><span>Choose where downloaded files are written.</span></div><div className="settings-directory-control"><TextInput aria-label="Download directory" value={value.downloadDirectory} onChange={event => set('downloadDirectory', event.target.value)} placeholder="Default: system Downloads/LotaGate Browser" /><Button variant="secondary" onClick={() => void chooseDownloadDirectory()}><Icon icon={FolderOpen} size={14} />Browse</Button></div></div>
      <div className="appearance-setting-row"><div><strong>Clear data on close</strong><span>Remove cookies, browser data, and session evidence when the session closes.</span></div><label className="settings-toggle"><input type="checkbox" checked={value.clearDataOnClose} onChange={event => set('clearDataOnClose', event.target.checked)} /><span>Enabled</span></label></div>
    </section>
    <section className="appearance-section appearance-settings-card">
      <div className="appearance-section-heading"><div><h2>Network access & evidence</h2><p>Restrict destinations and control how long screenshots and recordings remain available.</p></div></div>
      <div className="appearance-setting-row appearance-setting-row-stacked"><div><strong>Origin allowlist</strong><span>Restrict browser navigation to the listed HTTP(S) origins. Leave empty to allow all.</span></div><TextArea aria-label="Origin allowlist" value={value.originAllowlist.join('\n')} onChange={event => set('originAllowlist', normalizeOriginAllowlist([event.target.value]))} placeholder={'https://example.com, https://staging.example.com\nLeave empty to allow all HTTP(S) origins'} /></div>
      <div className="appearance-setting-row"><div><strong>Evidence retention</strong><span>Set how many days screenshots and recordings remain available.</span></div><TextInput aria-label="Evidence retention (days)" type="number" min={1} max={365} value={value.evidenceRetentionDays} onChange={event => set('evidenceRetentionDays', Number(event.target.value))} /></div>
    </section>
  </div>;
}
