import { useEffect, useRef, useState } from 'react';
import type { ComputerSettings } from '../../../contracts/ipc/v1/settings.js';
import { DEFAULT_COMPUTER_APPLICATION_ALLOWLIST, normalizeComputerApplicationAllowlist } from '../../../contracts/ipc/v1/computer-application-allowlist.js';
import { TextArea, useToast } from '../../components/ui.js';
import { SettingsPageSkeleton } from './SettingsPageSkeleton.js';

const defaults: ComputerSettings = { applicationAllowlist: [...DEFAULT_COMPUTER_APPLICATION_ALLOWLIST] };

export function ComputerUseSettingsPage() {
  const [value, setValue] = useState<ComputerSettings>(defaults);
  const [loading, setLoading] = useState(true);
  const valueRef = useRef(value);
  const saveSequenceRef = useRef(0);
  const { error } = useToast();

  useEffect(() => {
    let mounted = true;
    void window.lotagate.settings.get().then(settings => {
      if (!mounted) return;
      valueRef.current = settings.computer;
      setValue(settings.computer);
    }).catch(reason => {
      if (mounted) error('Unable to load Computer Use settings', reason instanceof Error ? reason.message : 'Please try again.');
    }).finally(() => {
      if (mounted) setLoading(false);
    });
    return () => { mounted = false; };
  }, [error]);

  const persist = async (next: ComputerSettings) => {
    const sequence = ++saveSequenceRef.current;
    try {
      const result = await window.lotagate.settings.update({ computer: next });
      if (sequence === saveSequenceRef.current) {
        valueRef.current = result.computer;
        setValue(result.computer);
      }
    } catch (reason) {
      error('Unable to save Computer Use settings', reason instanceof Error ? reason.message : 'Please try again.');
    }
  };

  const updateAllowlist = (text: string) => {
    const next = { applicationAllowlist: normalizeComputerApplicationAllowlist([text]) };
    valueRef.current = next;
    setValue(next);
    void persist(next);
  };

  if (loading) return <SettingsPageSkeleton rows={3} />;

  return <div className="appearance-page">
    <section className="appearance-section appearance-settings-card computer-use-settings-card">
      <div className="appearance-section-heading"><div><h2>Application access</h2><p>Choose which Windows applications LotaGate may launch through Computer Use.</p></div></div>
      <div className="appearance-setting-row appearance-setting-row-stacked">
        <div><strong>Allowed applications</strong><span>Enter application names or executable paths separated by commas. You can use either <code>notepad</code> or <code>notepad.exe</code>; matching is case-insensitive.</span></div>
        <TextArea aria-label="Allowed applications" value={value.applicationAllowlist.join(', ')} onChange={event => updateAllowlist(event.target.value)} placeholder="notepad, calc, mspaint" />
      </div>
    </section>
  </div>;
}
