import { useEffect, useRef, useState } from 'react';
import type { SandboxSettings } from '../../../contracts/ipc/v1/settings.js';
import { Dropdown, TextInput, useToast } from '../../components/ui.js';
import { SettingsPageSkeleton } from './SettingsPageSkeleton.js';

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
  const valueRef = useRef(value);
  const saveSequenceRef = useRef(0);
  const { error } = useToast();
  useEffect(() => { void window.lotagate.settings.get().then(settings => { valueRef.current = settings.sandbox; setValue(settings.sandbox); }).catch(reason => error('Unable to load Sandbox settings', reason instanceof Error ? reason.message : 'Please try again.')).finally(() => setLoading(false)); }, [error]);
  if (loading) return <SettingsPageSkeleton rows={5} />;
  const persist = async (next: SandboxSettings) => {
    const sequence = ++saveSequenceRef.current;
    try {
      const result = await window.lotagate.settings.update({ sandbox: next });
      if (sequence === saveSequenceRef.current) { valueRef.current = result.sandbox; setValue(result.sandbox); }
    } catch (reason) {
      error('Unable to save Sandbox settings', reason instanceof Error ? reason.message : 'Please try again.');
    }
  };
  const set = <K extends keyof SandboxSettings>(key: K, next: SandboxSettings[K]) => {
    const updated = { ...valueRef.current, [key]: next };
    valueRef.current = updated;
    setValue(updated);
    void persist(updated);
  };
  return <div className="appearance-page">
    <section className="appearance-section">
      <div className="appearance-section-heading"><div><h2>Sandbox</h2><p>Configure the isolated runtime for agent filesystem and shell operations. Host fallback never bypasses the shared approval coordinator or workspace trust.</p></div><span className="settings-status">Policy enforced by Desktop</span></div>
    </section>
    <section className="appearance-section appearance-settings-card">
      <div className="appearance-section-heading"><div><h2>Runtime backend</h2><p>Select the container engine and image used for isolated execution.</p></div></div>
      <div className="appearance-setting-row"><div><strong>Backend</strong><span>Select the container engine used for isolated execution.</span></div><Dropdown ariaLabel="Sandbox backend" value={value.backend} options={[{ value: 'auto', label: 'Auto · Docker, then Podman' }, { value: 'docker', label: 'Docker only' }, { value: 'podman', label: 'Podman only' }, { value: 'disabled', label: 'Disabled' }]} onChange={next => set('backend', next as SandboxSettings['backend'])} /></div>
      <div className="appearance-setting-row"><div><strong>Container image</strong><span>Select the base image used by isolated execution.</span></div><Dropdown ariaLabel="Container image" value={value.image} options={sandboxImageOptions.some(option => option.value === value.image) ? sandboxImageOptions : [{ value: value.image, label: `${value.image} · configured` }, ...sandboxImageOptions]} onChange={next => set('image', next)} /></div>
      <div className="appearance-setting-row"><div><strong>Network policy</strong><span>Choose whether sandbox processes can access the network.</span></div><Dropdown ariaLabel="Network policy" value={value.networkPolicy} options={[{ value: 'none', label: 'No network' }, { value: 'full', label: 'Network enabled' }]} onChange={next => set('networkPolicy', next as SandboxSettings['networkPolicy'])} /></div>
      <div className="appearance-setting-row"><div><strong>Workspace mount</strong><span>Choose whether the workspace is mounted read-only or read-write.</span></div><Dropdown ariaLabel="Workspace mount mode" value={value.mountMode} options={[{ value: 'read-only', label: 'Read-only' }, { value: 'read-write', label: 'Read and write' }]} onChange={next => set('mountMode', next as SandboxSettings['mountMode'])} /></div>
    </section>
    <section className="appearance-section appearance-settings-card">
      <div className="appearance-section-heading"><div><h2>Resource limits</h2><p>Bound memory, CPU, and process count for predictable local execution.</p></div></div>
      <div className="appearance-setting-row"><div><strong>Memory limit</strong><span>Set the maximum memory available to the sandbox in megabytes.</span></div><TextInput aria-label="Memory limit (MB)" type="number" min={128} max={16384} value={value.memoryMb} onChange={event => set('memoryMb', Number(event.target.value))} /></div>
      <div className="appearance-setting-row"><div><strong>CPU limit</strong><span>Set the maximum number of CPU cores available to the sandbox.</span></div><TextInput aria-label="CPU limit (cores)" type="number" min={0.25} max={16} step={0.25} value={value.cpuCores} onChange={event => set('cpuCores', Number(event.target.value))} /></div>
      <div className="appearance-setting-row"><div><strong>Process limit</strong><span>Set the maximum number of processes allowed in the sandbox.</span></div><TextInput aria-label="Process limit (PIDs)" type="number" min={16} max={4096} value={value.pidsLimit} onChange={event => set('pidsLimit', Number(event.target.value))} /></div>
    </section>
    <section className="appearance-section appearance-settings-card">
      <div className="appearance-section-heading"><div><h2>Policy & lifecycle</h2><p>Define what happens when the sandbox cannot start and how diagnostics are retained.</p></div></div>
      <div className="appearance-setting-row"><div><strong>Host fallback</strong><span>Choose how to handle execution when the sandbox is unavailable.</span></div><Dropdown ariaLabel="Sandbox fallback" value={value.hostFallback} options={[{ value: 'ask', label: 'Ask for approval' }, { value: 'allow', label: 'Allow host fallback' }, { value: 'deny', label: 'Deny action' }]} onChange={next => set('hostFallback', next as SandboxSettings['hostFallback'])} /></div>
      <div className="appearance-setting-row"><div><strong>Container cleanup</strong><span>Choose when completed sandbox containers are removed.</span></div><Dropdown ariaLabel="Container cleanup" value={value.cleanup} options={[{ value: 'always', label: 'Always remove container' }, { value: 'on-success', label: 'Remove after success' }]} onChange={next => set('cleanup', next as SandboxSettings['cleanup'])} /></div>
      <div className="appearance-setting-row"><div><strong>Diagnostics retention</strong><span>Set how many days sandbox diagnostics remain available.</span></div><TextInput aria-label="Diagnostics retention (days)" type="number" min={1} max={365} value={value.diagnosticsRetentionDays} onChange={event => set('diagnosticsRetentionDays', Number(event.target.value))} /></div>
    </section>
  </div>;
}
