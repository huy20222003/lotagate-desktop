import { useEffect, useRef, useState } from 'react';
import type { ComputerSettings } from '../../../contracts/ipc/v1/settings.js';
import { DEFAULT_COMPUTER_APPLICATION_ALLOWLIST, defaultComputerApplicationAllowlist, normalizeComputerApplicationAllowlist } from '../../../contracts/ipc/v1/computer-application-allowlist.js';
import { Button, TextArea, useToast } from '../../components/ui.js';
import { SettingsPageSkeleton } from './SettingsPageSkeleton.js';

const defaults: ComputerSettings = { applicationAllowlist: [...DEFAULT_COMPUTER_APPLICATION_ALLOWLIST] };

export function ComputerUseSettingsPage() {
  const [allowlistText, setAllowlistText] = useState(defaults.applicationAllowlist.join(', '));
  const [loading, setLoading] = useState(true);
  const [defaultAllowlist, setDefaultAllowlist] = useState<string[]>([...DEFAULT_COMPUTER_APPLICATION_ALLOWLIST]);
  const saveSequenceRef = useRef(0);
  const { error } = useToast();

  useEffect(() => {
    let mounted = true;
    void window.lotagate.settings.get().then(settings => {
      if (!mounted) return;
      setAllowlistText(settings.computer.applicationAllowlist.join(', '));
    }).catch(reason => {
      if (mounted) error('Unable to load Computer Use settings', reason instanceof Error ? reason.message : 'Please try again.');
    }).finally(() => {
      if (mounted) setLoading(false);
    });
    void window.lotagate.updates.getInfo().then(info => {
      if (!mounted) return;
      const platform = info.platform === 'MACOS' ? 'darwin' : info.platform === 'LINUX' ? 'linux' : 'win32';
      // Keep the reset action aligned with the native provider selected by Desktop.
      setDefaultAllowlist([...defaultComputerApplicationAllowlist(platform)]);
    }).catch(() => undefined);
    return () => { mounted = false; };
  }, [error]);

  const persist = async (next: ComputerSettings) => {
    const sequence = ++saveSequenceRef.current;
    try {
      await window.lotagate.settings.update({ computer: next });
    } catch (reason) {
      if (sequence === saveSequenceRef.current) error('Unable to save Computer Use settings', reason instanceof Error ? reason.message : 'Please try again.');
    }
  };

  const updateAllowlist = (text: string) => {
    setAllowlistText(text);
    const next = { applicationAllowlist: normalizeComputerApplicationAllowlist([text]) };
    void persist(next);
  };

  const commitAllowlist = () => {
    const normalized = normalizeComputerApplicationAllowlist([allowlistText]);
    const nextText = normalized.join(', ');
    if (nextText !== allowlistText) setAllowlistText(nextText);
    const next = { applicationAllowlist: normalized };
    void persist(next);
  };

  const restoreDefaults = () => updateAllowlist(defaultAllowlist.join(', '));

  if (loading) return <SettingsPageSkeleton rows={3} />;

  return <div className="appearance-page">
    <section className="appearance-section appearance-settings-card computer-use-settings-card">
      <div className="appearance-section-heading"><div><h2>Application access</h2><p>Choose which desktop applications LotaGate may launch through Computer Use.</p></div></div>
      <div className="appearance-setting-row appearance-setting-row-stacked">
        <div><strong>Allowed applications</strong><span>Enter application names or executable paths separated by commas. You can use either <code>notepad</code> or <code>notepad.exe</code>; matching is case-insensitive.</span></div>
        <TextArea aria-label="Allowed applications" value={allowlistText} onChange={event => updateAllowlist(event.target.value)} onBlur={commitAllowlist} placeholder="notepad.exe, calc.exe, mspaint.exe" />
        <div className="settings-inline-actions"><Button type="button" variant="secondary" onClick={restoreDefaults}>Restore safe defaults</Button></div>
      </div>
    </section>
  </div>;
}
