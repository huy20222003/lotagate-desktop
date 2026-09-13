import { useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { SANDBOX_DEFAULTS, SANDBOX_LIMITS, type SandboxHealthSnapshot, type SandboxSettings } from '../../../contracts/ipc/v1/settings.js';
import { Badge, Button, Dropdown, TextInput, useToast } from '../../components/ui.js';
import { SettingsPageSkeleton } from './SettingsPageSkeleton.js';

const defaults: SandboxSettings = { ...SANDBOX_DEFAULTS, allowedDomains: [...SANDBOX_DEFAULTS.allowedDomains] };

export function SandboxSettingsPage() {
  const [value, setValue] = useState<SandboxSettings>(defaults);
  const [loading, setLoading] = useState(true);
  const [health, setHealth] = useState<SandboxHealthSnapshot>();
  const [repairing, setRepairing] = useState(false);
  const valueRef = useRef(value);
  const saveSequenceRef = useRef(0);
  const { error } = useToast();

  useEffect(() => {
    void window.lotagate.settings.get()
      .then(settings => { valueRef.current = settings.sandbox; setValue(settings.sandbox); })
      .catch(reason => error('Unable to load VM sandbox settings', reason instanceof Error ? reason.message : 'Please try again.'))
      .finally(() => setLoading(false));
    void window.lotagate.sandbox.health()
      .then(setHealth)
      .catch(reason => error('Unable to inspect VM sandbox', reason instanceof Error ? reason.message : 'Please try again.'));
  }, [error]);

  if (loading) return <SettingsPageSkeleton rows={8} />;

  const persist = async (next: SandboxSettings): Promise<void> => {
    const sequence = ++saveSequenceRef.current;
    try {
      const result = await window.lotagate.settings.update({ sandbox: next });
      if (sequence === saveSequenceRef.current) { valueRef.current = result.sandbox; setValue(result.sandbox); }
    } catch (reason) {
      error('Unable to save VM sandbox settings', reason instanceof Error ? reason.message : 'Please try again.');
    }
  };

  const set = <K extends keyof SandboxSettings>(key: K, next: SandboxSettings[K]): void => {
    const updated = { ...valueRef.current, [key]: next };
    valueRef.current = updated;
    setValue(updated);
    void persist(updated);
  };

  const repair = async (): Promise<void> => {
    setRepairing(true);
    try { setHealth(await window.lotagate.sandbox.repair()); }
    catch (reason) { error('Unable to repair VM dependencies', reason instanceof Error ? reason.message : 'Please try again.'); }
    finally { setRepairing(false); }
  };

  return <div className="appearance-page">
    <section className="appearance-section appearance-settings-card">
      <div className="appearance-section-heading"><div><h2>VM health</h2><p>Runtime and guest dependencies are checked independently from the saved policy.</p></div><Button type="button" variant="secondary" disabled={repairing} onClick={() => void repair()}>{repairing ? 'Repairing…' : 'Repair VM and dependencies'}</Button></div>
      <SettingRow title="Status" description={healthDescription(health)}><Badge tone={healthTone(health)}>{healthLabel(health)}</Badge></SettingRow>
      {health?.runtime.adminRequired ? <SettingRow title="Administrator action" description="Windows needs administrator approval to enable WSL2 and VirtualMachinePlatform."><span>Repair will show a Windows UAC prompt.</span></SettingRow> : null}
      {health?.runtime.restartRequired ? <SettingRow title="Restart required" description="Windows must restart before the VM can be used."><span>Restart Windows, then reopen Desktop.</span></SettingRow> : null}
      {health?.runtime.resourceQuota ? <SettingRow title="Resource enforcement" description="Shows the strongest quota boundary available on this operating system."><span>{health.runtime.resourceQuota === 'cgroup' ? 'Linux cgroup v2' : 'Guest process limits'}</span></SettingRow> : null}
      {health?.dependencies.missing.length ? <SettingRow title="Missing dependencies" description="These manifest entries can be installed in the selected guest profile."><span>{health.dependencies.missing.join(', ')}</span></SettingRow> : null}
      {health?.dependencies.manual.length ? <SettingRow title="Manual dependencies" description="These entries require an administrator or a package source outside automatic repair."><span>{health.dependencies.manual.join(', ')}</span></SettingRow> : null}
    </section>

    <section className="appearance-section appearance-settings-card">
      <div className="appearance-section-heading"><div><h2>VM runtime</h2><p>Agent filesystem, shell, git, and portable document operations run inside this isolated guest.</p></div></div>
      <SettingRow title="Runtime" description="Desktop selects WSL2 on Windows, bubblewrap on Linux, and Seatbelt on macOS."><Dropdown ariaLabel="VM runtime" value={value.runtime} options={[{ value: 'auto', label: 'Auto · native isolated runtime' }, { value: 'wsl2', label: 'WSL2 on Windows' }, { value: 'disabled', label: 'Disabled' }]} onChange={next => set('runtime', next as SandboxSettings['runtime'])} /></SettingRow>
      <SettingRow title="Guest distribution" description="Used by WSL2 on Windows; Linux and macOS use the host OS-native sandbox backend."><TextInput aria-label="Guest distribution" value={value.distribution} onChange={event => set('distribution', event.target.value)} /></SettingRow>
      <SettingRow title="Workspace access" description="Limit the guest workspace to read-only or read-write operations."><Dropdown ariaLabel="VM workspace access" value={value.workspaceAccess} options={[{ value: 'read-only', label: 'Read-only' }, { value: 'read-write', label: 'Read and write' }]} onChange={next => set('workspaceAccess', next as SandboxSettings['workspaceAccess'])} /></SettingRow>
    </section>

    <section className="appearance-section appearance-settings-card">
      <div className="appearance-section-heading"><div><h2>Network policy</h2><p>Network access is independent from permission approval and host fallback.</p></div></div>
      <SettingRow title="Guest network" description="The default is isolated networking. Allowlisted guest egress is unavailable until the guest proxy boundary is implemented."><Dropdown ariaLabel="VM network policy" value={value.networkPolicy} options={[{ value: 'none', label: 'No network' }, { value: 'allowlist', label: 'Allowlisted domains (unavailable)' }, { value: 'full', label: 'Full network' }]} onChange={next => set('networkPolicy', next as SandboxSettings['networkPolicy'])} /></SettingRow>
      {value.networkPolicy === 'allowlist' ? <SettingRow title="Allowed domains" description="Comma-separated HTTP(S) domains available to guest operations."><TextInput aria-label="Allowed domains" value={value.allowedDomains.join(', ')} onChange={event => set('allowedDomains', parseDomains(event.target.value))} /></SettingRow> : null}
    </section>

    <section className="appearance-section appearance-settings-card">
      <div className="appearance-section-heading"><div><h2>Resource and concurrency limits</h2><p>Bound guest resources and apply backpressure before the host is overloaded.</p></div></div>
      <NumericRow title="Memory limit" description="Maximum guest memory in megabytes." label="Memory limit (MB)" value={value.memoryMb} min={SANDBOX_LIMITS.memoryMb.min} max={SANDBOX_LIMITS.memoryMb.max} onChange={next => set('memoryMb', next)} />
      <NumericRow title="CPU limit" description="Maximum guest CPU cores." label="CPU limit (cores)" value={value.cpuCores} min={SANDBOX_LIMITS.cpuCores.min} max={SANDBOX_LIMITS.cpuCores.max} step={0.25} onChange={next => set('cpuCores', next)} />
      <NumericRow title="Process limit" description="Maximum guest process count." label="Process limit (PIDs)" value={value.pidsLimit} min={SANDBOX_LIMITS.pidsLimit.min} max={SANDBOX_LIMITS.pidsLimit.max} onChange={next => set('pidsLimit', next)} />
      <NumericRow title="Disk limit" description="Reserved guest workspace disk in megabytes." label="Disk limit (MB)" value={value.diskMb} min={SANDBOX_LIMITS.diskMb.min} max={SANDBOX_LIMITS.diskMb.max} onChange={next => set('diskMb', next)} />
      <NumericRow title="Concurrent environments" description="Maximum distinct workspace environments active at once." label="Concurrent environments" value={value.maxConcurrentEnvironments} min={SANDBOX_LIMITS.maxConcurrentEnvironments.min} max={SANDBOX_LIMITS.maxConcurrentEnvironments.max} onChange={next => set('maxConcurrentEnvironments', next)} />
      <NumericRow title="Concurrent operations" description="Maximum guest operations across active environments." label="Concurrent operations" value={value.maxConcurrentOperations} min={SANDBOX_LIMITS.maxConcurrentOperations.min} max={SANDBOX_LIMITS.maxConcurrentOperations.max} onChange={next => set('maxConcurrentOperations', next)} />
    </section>

    <section className="appearance-section appearance-settings-card">
      <div className="appearance-section-heading"><div><h2>Fallback and lifecycle</h2><p>Computer Use and the Terminal drawer remain host-native and are not controlled by this VM policy.</p></div></div>
      <SettingRow title="Host fallback" description="Choose what happens when the VM is unavailable."><Dropdown ariaLabel="VM host fallback" value={value.hostFallback} options={[{ value: 'ask', label: 'Ask for approval' }, { value: 'allow', label: 'Allow host fallback' }, { value: 'deny', label: 'Deny action' }]} onChange={next => set('hostFallback', next as SandboxSettings['hostFallback'])} /></SettingRow>
      <NumericRow title="Idle timeout" description="Shut down an unused guest environment after this many minutes." label="Idle timeout (minutes)" value={value.idleTimeoutMinutes} min={SANDBOX_LIMITS.idleTimeoutMinutes.min} max={SANDBOX_LIMITS.idleTimeoutMinutes.max} onChange={next => set('idleTimeoutMinutes', next)} />
      <NumericRow title="Diagnostics retention" description="Keep VM lifecycle and execution diagnostics for this many days." label="Diagnostics retention (days)" value={value.diagnosticsRetentionDays} min={SANDBOX_LIMITS.diagnosticsRetentionDays.min} max={SANDBOX_LIMITS.diagnosticsRetentionDays.max} onChange={next => set('diagnosticsRetentionDays', next)} />
    </section>
  </div>;
}

function SettingRow(props: { title: string; description: string; children: ReactNode }): ReactElement {
  return <div className="appearance-setting-row"><div><strong>{props.title}</strong><span>{props.description}</span></div>{props.children}</div>;
}

function NumericRow(props: { title: string; description: string; label: string; value: number; min: number; max: number; step?: number; onChange: (value: number) => void }): ReactElement {
  return <SettingRow title={props.title} description={props.description}><TextInput aria-label={props.label} type="number" min={props.min} max={props.max} step={props.step} value={props.value} onChange={event => props.onChange(Number(event.target.value))} /></SettingRow>;
}

function parseDomains(value: string): string[] {
  return [...new Set(value.split(',').map(item => item.trim()).filter(item => item.length > 0))].slice(0, 256);
}

function healthLabel(health: SandboxHealthSnapshot | undefined): string {
  if (health === undefined) return 'Checking…';
  return health.state === 'ready' ? 'Ready' : health.state === 'degraded' ? 'Needs attention' : health.state === 'disabled' ? 'Disabled' : 'Unavailable';
}

function healthTone(health: SandboxHealthSnapshot | undefined): 'neutral' | 'success' | 'warning' | 'danger' {
  if (health?.state === 'ready') return 'success';
  if (health?.state === 'degraded') return 'warning';
  if (health?.state === 'unavailable') return 'danger';
  return 'neutral';
}

function healthDescription(health: SandboxHealthSnapshot | undefined): string {
  if (health === undefined) return 'Checking the selected runtime and guest profile.';
  if (health.state === 'disabled') return 'The VM sandbox is disabled in Settings.';
  if (health.runtime.reason !== undefined) return health.runtime.reason;
  const runtime = health.runtime.runtime === 'unsupported' ? 'No sandbox backend' : health.runtime.runtime === 'wsl2' ? `WSL2 ${health.runtime.distribution}` : health.runtime.runtime === 'bubblewrap' ? 'Linux bubblewrap' : 'macOS Seatbelt';
  return `${runtime} · checked ${new Date(health.checkedAt).toLocaleTimeString()}.`;
}
