import { useEffect, useState } from 'react';
import type { SandboxSettings } from '../../../contracts/ipc/v1/settings.js';
import { Button, Card, Dropdown, Field, TextInput, useToast } from '../../components/ui.js';

const defaults: SandboxSettings = { backend: 'auto', image: 'node:22-bookworm-slim', networkPolicy: 'none', mountMode: 'read-write', memoryMb: 2_048, cpuCores: 2, pidsLimit: 128, hostFallback: 'ask', cleanup: 'always', diagnosticsRetentionDays: 30 };
const sandboxImageOptions = [
  { value: 'node:22-alpine', label: 'Node 22 Alpine · lightweight' },
  { value: 'node:22-bookworm-slim', label: 'Node 22 Bookworm Slim · balanced' },
  { value: 'python:3.13-slim', label: 'Python 3.13 Slim · Python workloads' },
  { value: 'node:22-bookworm', label: 'Node 22 Bookworm · full Debian base' },
  { value: 'ubuntu:24.04', label: 'Ubuntu 24.04 · full general-purpose base' },
];

export function SandboxSettingsPage() {
  const [value, setValue] = useState<SandboxSettings>(defaults);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const { success, error } = useToast();
  useEffect(() => { void window.lotagate.settings.get().then(settings => setValue(settings.sandbox)).catch(reason => error('Unable to load Sandbox settings', reason instanceof Error ? reason.message : 'Please try again.')).finally(() => setLoading(false)); }, [error]);
  const save = async () => { setSaving(true); try { const result = await window.lotagate.settings.update({ sandbox: value }); setValue(result.sandbox); success('Sandbox settings saved'); } catch (reason) { error('Unable to save Sandbox settings', reason instanceof Error ? reason.message : 'Please try again.'); } finally { setSaving(false); } };
  if (loading) return <div className="settings-loading">Loading Sandbox settings…</div>;
  const set = <K extends keyof SandboxSettings>(key: K, next: SandboxSettings[K]) => setValue(current => ({ ...current, [key]: next }));
  return <div className="execution-settings-page">
    <section className="settings-intro settings-feature-intro"><div><h2>Sandbox</h2><p>Configure the isolated runtime for agent filesystem and shell operations. Host fallback never bypasses the shared approval coordinator or workspace trust.</p></div><span className="settings-status">Policy enforced by Desktop</span></section>
    <div className="settings-card-grid">
      <Card className="settings-form-card"><div className="settings-card-heading"><div><h3>Runtime backend</h3><p>Select the container engine and image used for isolated execution.</p></div></div><div className="settings-form-grid"><Field label="Backend"><Dropdown ariaLabel="Sandbox backend" value={value.backend} options={[{ value: 'auto', label: 'Auto · Docker, then Podman' }, { value: 'docker', label: 'Docker only' }, { value: 'podman', label: 'Podman only' }, { value: 'disabled', label: 'Disabled' }]} onChange={next => set('backend', next as SandboxSettings['backend'])} /></Field><div className="field-wide"><Field label="Container image"><Dropdown ariaLabel="Container image" value={value.image} options={sandboxImageOptions.some(option => option.value === value.image) ? sandboxImageOptions : [{ value: value.image, label: `${value.image} · configured` }, ...sandboxImageOptions]} onChange={next => set('image', next)} /></Field></div><Field label="Network policy"><Dropdown ariaLabel="Network policy" value={value.networkPolicy} options={[{ value: 'none', label: 'No network' }, { value: 'full', label: 'Network enabled' }]} onChange={next => set('networkPolicy', next as SandboxSettings['networkPolicy'])} /></Field><Field label="Workspace mount"><Dropdown ariaLabel="Workspace mount mode" value={value.mountMode} options={[{ value: 'read-only', label: 'Read-only' }, { value: 'read-write', label: 'Read and write' }]} onChange={next => set('mountMode', next as SandboxSettings['mountMode'])} /></Field></div></Card>
      <Card className="settings-form-card"><div className="settings-card-heading"><div><h3>Resource limits</h3><p>Bound memory, CPU, and process count for predictable local execution.</p></div></div><div className="settings-form-grid"><Field label="Memory limit (MB)"><TextInput type="number" min={128} max={16384} value={value.memoryMb} onChange={event => set('memoryMb', Number(event.target.value))} /></Field><Field label="CPU limit (cores)"><TextInput type="number" min={0.25} max={16} step={0.25} value={value.cpuCores} onChange={event => set('cpuCores', Number(event.target.value))} /></Field><Field label="Process limit (PIDs)"><TextInput type="number" min={16} max={4096} value={value.pidsLimit} onChange={event => set('pidsLimit', Number(event.target.value))} /></Field></div></Card>
      <Card className="settings-form-card settings-form-card-wide"><div className="settings-card-heading"><div><h3>Policy & lifecycle</h3><p>Define what happens when the sandbox cannot start and how diagnostics are retained.</p></div></div><div className="settings-form-grid"><Field label="Fallback when sandbox is unavailable"><Dropdown ariaLabel="Sandbox fallback" value={value.hostFallback} options={[{ value: 'ask', label: 'Ask for approval' }, { value: 'allow', label: 'Allow host fallback' }, { value: 'deny', label: 'Deny action' }]} onChange={next => set('hostFallback', next as SandboxSettings['hostFallback'])} /></Field><Field label="Container cleanup"><Dropdown ariaLabel="Container cleanup" value={value.cleanup} options={[{ value: 'always', label: 'Always remove container' }, { value: 'on-success', label: 'Remove after success' }]} onChange={next => set('cleanup', next as SandboxSettings['cleanup'])} /></Field><Field label="Diagnostics retention (days)"><TextInput type="number" min={1} max={365} value={value.diagnosticsRetentionDays} onChange={event => set('diagnosticsRetentionDays', Number(event.target.value))} /></Field></div><div className="settings-warning">Autonomous automations always deny host fallback. In interactive mode, <strong>Ask for approval</strong> sends the fallback decision to the same Composer approval surface used by Browser, Git, and Terminal.</div></Card>
    </div>
    <div className="settings-form-actions"><Button variant="primary" onClick={() => void save()} disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</Button></div>
  </div>;
}
