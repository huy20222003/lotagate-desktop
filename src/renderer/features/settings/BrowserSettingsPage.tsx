import { useEffect, useRef, useState } from 'react';
import { FolderOpen } from 'lucide-react';
import type { BrowserSettings } from '../../../contracts/ipc/v1/settings.js';
import { normalizeOriginAllowlist } from '../../../contracts/ipc/v1/origin-allowlist.js';
import { Button, Card, Dropdown, Field, TextArea, TextInput, useToast } from '../../components/ui.js';

const defaults: BrowserSettings = { viewportProfile: 'desktop', customViewport: { width: 1_280, height: 800, mobile: false, deviceScaleFactor: 1 }, downloadDirectory: '', sessionRetention: 'persistent', sessionRetentionMinutes: 60, originAllowlist: [], clearDataOnClose: false, evidenceRetentionDays: 30 };
const viewportOptions = [{ value: 'desktop', label: 'Desktop · 1280 × 800' }, { value: 'laptop', label: 'Laptop · 1440 × 900' }, { value: 'tablet', label: 'Tablet · 1024 × 768' }, { value: 'mobile', label: 'Mobile · 390 × 844' }, { value: 'custom', label: 'Custom device profile' }];
const retentionOptions = [{ value: 'session', label: 'Session only' }, { value: 'persistent', label: 'Persistent profile' }, { value: 'ttl', label: 'Expire after timeout' }];

export function BrowserSettingsPage() {
  const [value, setValue] = useState<BrowserSettings>(defaults);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const valueRef = useRef(value);
  const saveSequenceRef = useRef(0);
  const pendingSavesRef = useRef(0);
  const { error } = useToast();
  useEffect(() => { void window.lotagate.settings.get().then(settings => { valueRef.current = settings.browser; setValue(settings.browser); }).catch(reason => error('Unable to load Browser settings', reason instanceof Error ? reason.message : 'Please try again.')).finally(() => setLoading(false)); }, [error]);
  if (loading) return <div className="settings-loading">Loading Browser settings…</div>;
  const persist = async (next: BrowserSettings) => {
    const sequence = ++saveSequenceRef.current;
    pendingSavesRef.current += 1;
    setSaving(true);
    try {
      const result = await window.lotagate.settings.update({ browser: next });
      if (sequence === saveSequenceRef.current) { valueRef.current = result.browser; setValue(result.browser); }
    } catch (reason) {
      error('Unable to save Browser settings', reason instanceof Error ? reason.message : 'Please try again.');
    } finally {
      pendingSavesRef.current -= 1;
      if (pendingSavesRef.current === 0) setSaving(false);
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
  return <div className="execution-settings-page">
    <section className="settings-intro settings-feature-intro"><div><h2>Browser</h2><p>Define the browser environment used by the agent and by manual Browser sessions. These defaults apply consistently to navigation, inspection, downloads, and evidence.</p></div><span className="settings-status">Desktop browser</span></section>
    <div className="settings-card-grid">
      <Card className="settings-form-card"><div className="settings-card-heading"><div><h3>Viewport & device</h3><p>Choose the screen profile that browser pages should render against.</p></div></div><div className="settings-form-grid"><Field label="Viewport profile"><Dropdown ariaLabel="Viewport profile" value={value.viewportProfile} options={viewportOptions} onChange={next => set('viewportProfile', next as BrowserSettings['viewportProfile'])} /></Field>{value.viewportProfile === 'custom' ? <><Field label="Viewport width (px)"><TextInput type="number" min={320} max={3840} value={value.customViewport.width} onChange={event => set('customViewport', { ...value.customViewport, width: Number(event.target.value) })} /></Field><Field label="Viewport height (px)"><TextInput type="number" min={240} max={2160} value={value.customViewport.height} onChange={event => set('customViewport', { ...value.customViewport, height: Number(event.target.value) })} /></Field><Field label="Device scale factor"><TextInput type="number" min={1} max={4} step={0.25} value={value.customViewport.deviceScaleFactor} onChange={event => set('customViewport', { ...value.customViewport, deviceScaleFactor: Number(event.target.value) })} /></Field></> : null}</div>{value.viewportProfile === 'custom' ? <label className="settings-toggle"><input type="checkbox" checked={value.customViewport.mobile} onChange={event => set('customViewport', { ...value.customViewport, mobile: event.target.checked })} /><span><strong>Emulate a mobile device</strong><small>Use mobile viewport behavior and touch-oriented page rendering.</small></span></label> : null}</Card>
      <Card className="settings-form-card"><div className="settings-card-heading"><div><h3>Profile & downloads</h3><p>Control browser data lifetime and where downloaded files are written.</p></div></div><div className="settings-form-grid"><Field label="Session retention"><Dropdown ariaLabel="Session retention" value={value.sessionRetention} options={retentionOptions} onChange={next => set('sessionRetention', next as BrowserSettings['sessionRetention'])} /></Field>{value.sessionRetention === 'ttl' ? <Field label="Retention timeout (minutes)"><TextInput type="number" min={1} max={10080} value={value.sessionRetentionMinutes} onChange={event => set('sessionRetentionMinutes', Number(event.target.value))} /></Field> : null}<div className="field-wide"><Field label="Download directory"><div className="settings-directory-control"><TextInput value={value.downloadDirectory} onChange={event => set('downloadDirectory', event.target.value)} placeholder="Default: system Downloads/LotaGate Browser" /><Button variant="secondary" onClick={() => void chooseDownloadDirectory()}><FolderOpen size={14} />Browse</Button></div></Field></div></div><label className="settings-toggle"><input type="checkbox" checked={value.clearDataOnClose} onChange={event => set('clearDataOnClose', event.target.checked)} /><span><strong>Clear cookies and browser data when the session closes</strong><small>Useful for clean test runs. Session evidence is removed as part of the same cleanup.</small></span></label></Card>
      <Card className="settings-form-card settings-form-card-wide"><div className="settings-card-heading"><div><h3>Network access & evidence</h3><p>Restrict destinations and control how long screenshots and recordings remain available.</p></div></div><div className="settings-form-grid"><div className="field-wide"><Field label="Origin allowlist"><TextArea value={value.originAllowlist.join('\n')} onChange={event => set('originAllowlist', normalizeOriginAllowlist([event.target.value]))} placeholder={'https://example.com, https://staging.example.com\nLeave empty to allow all HTTP(S) origins'} /></Field></div><Field label="Evidence retention (days)"><TextInput type="number" min={1} max={365} value={value.evidenceRetentionDays} onChange={event => set('evidenceRetentionDays', Number(event.target.value))} /></Field></div></Card>
    </div>
    <div className="settings-form-actions">{saving ? <span className="settings-save-status">Saving…</span> : <span className="settings-save-status">Changes are saved automatically.</span>}</div>
  </div>;
}
