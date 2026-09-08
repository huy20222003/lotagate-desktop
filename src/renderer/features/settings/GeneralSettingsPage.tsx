import { useEffect, useRef, useState } from 'react';
import type { DesktopSettingsSnapshot, FileOpenDestination, TerminalPlacement, TerminalShell } from '../../../contracts/ipc/v1/settings.js';
import { Card, Checkbox, Dropdown, ToggleSwitch, useToast } from '../../components/ui.js';
import { SettingsPageSkeleton } from './SettingsPageSkeleton.js';

const shellOptions = [
  { value: 'powershell', label: 'PowerShell' },
  { value: 'cmd', label: 'Command Prompt' },
  { value: 'git-bash', label: 'Git Bash' },
];
const placementOptions = [
  { value: 'bottom', label: 'Bottom panel' },
  { value: 'right', label: 'Right drawer' },
];
const fontSizeOptions = [
  { value: '11', label: '11 px' },
  { value: '12', label: '12 px' },
  { value: '13', label: '13 px' },
  { value: '14', label: '14 px' },
  { value: '16', label: '16 px' },
  { value: '18', label: '18 px' },
];
const scrollbackOptions = [
  { value: '1000', label: '1,000 lines' },
  { value: '5000', label: '5,000 lines' },
  { value: '10000', label: '10,000 lines' },
  { value: '25000', label: '25,000 lines' },
  { value: '50000', label: '50,000 lines' },
];
const fileOpenDestinationOptions = [
  { value: 'vscode', label: 'VS Code' },
  { value: 'file-explorer', label: 'File Explorer' },
];

type GeneralSettingsPatch = Partial<Pick<DesktopSettingsSnapshot, 'terminalShell' | 'terminalPlacement' | 'terminalFontSize' | 'terminalScrollback' | 'terminalCursorBlink' | 'defaultFileOpenDestination' | 'showContextWindowUsage'>>;

export function GeneralSettingsPage() {
  const { error } = useToast();
  const errorRef = useRef(error);
  errorRef.current = error;
  const [shell, setShell] = useState<TerminalShell>('powershell');
  const [placement, setPlacement] = useState<TerminalPlacement>('bottom');
  const [fontSize, setFontSize] = useState(13);
  const [scrollback, setScrollback] = useState(10_000);
  const [cursorBlink, setCursorBlink] = useState(true);
  const [fileOpenDestination, setFileOpenDestination] = useState<FileOpenDestination>('file-explorer');
  const [showContextWindowUsage, setShowContextWindowUsage] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let mounted = true;
    void window.lotagate.settings.get().then(settings => {
      if (!mounted) return;
      setShell(settings.terminalShell);
      setPlacement(settings.terminalPlacement);
      setFontSize(settings.terminalFontSize);
      setScrollback(settings.terminalScrollback);
      setCursorBlink(settings.terminalCursorBlink);
      setFileOpenDestination(settings.defaultFileOpenDestination);
      setShowContextWindowUsage(settings.showContextWindowUsage);
    }).catch(reason => { if (mounted) errorRef.current('Unable to load general settings', reason instanceof Error ? reason.message : 'Please try again.'); })
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, []);

  const update = async (patch: GeneralSettingsPatch) => {
    setBusy(true);
    try {
      const next = await window.lotagate.settings.update(patch);
      setShell(next.terminalShell);
      setPlacement(next.terminalPlacement);
      setFontSize(next.terminalFontSize);
      setScrollback(next.terminalScrollback);
      setCursorBlink(next.terminalCursorBlink);
      setFileOpenDestination(next.defaultFileOpenDestination);
      setShowContextWindowUsage(next.showContextWindowUsage);
    } catch (reason) {
      errorRef.current('Unable to update general settings', reason instanceof Error ? reason.message : 'Please try again.');
    } finally { setBusy(false); }
  };

  if (loading) return <SettingsPageSkeleton rows={7} />;

  return <div className="appearance-page">
    <section className="appearance-section">
      <div className="appearance-section-heading"><div><h2>Terminal</h2><p>Choose how the integrated terminal runs and where it appears.</p></div></div>
      <Card className="appearance-settings-card">
        <div className="appearance-setting-row"><div><strong>Integrated terminal shell</strong><span>Choose which shell opens in the integrated terminal.</span></div><Dropdown value={shell} options={shellOptions} onChange={value => { const next = value as TerminalShell; setShell(next); void update({ terminalShell: next }); }} disabled={busy} aria-label="Integrated terminal shell" /></div>
        <div className="appearance-setting-row"><div><strong>Terminal placement</strong><span>Choose where the terminal opens in the workspace.</span></div><Dropdown value={placement} options={placementOptions} onChange={value => { const next = value as TerminalPlacement; setPlacement(next); void update({ terminalPlacement: next }); }} disabled={busy} aria-label="Terminal placement" /></div>
        <div className="appearance-setting-row"><div><strong>Terminal font size</strong><span>Set the text size used by integrated terminal sessions.</span></div><Dropdown value={String(fontSize)} options={fontSizeOptions} onChange={value => { const next = Number(value); setFontSize(next); void update({ terminalFontSize: next }); }} disabled={busy} aria-label="Terminal font size" /></div>
        <div className="appearance-setting-row"><div><strong>Terminal scrollback</strong><span>Choose how many terminal lines remain available to scroll back.</span></div><Dropdown value={String(scrollback)} options={scrollbackOptions} onChange={value => { const next = Number(value); setScrollback(next); void update({ terminalScrollback: next }); }} disabled={busy} aria-label="Terminal scrollback" /></div>
        <div className="appearance-setting-row"><div><strong>Cursor blink</strong><span>Animate the cursor in integrated terminal sessions.</span></div><Checkbox label="Cursor blink" checked={cursorBlink} onChange={next => { setCursorBlink(next); void update({ terminalCursorBlink: next }); }} /></div>
      </Card>
    </section>
    <section className="appearance-section">
      <div className="appearance-section-heading"><div><h2>Files</h2><p>Choose where file links open by default.</p></div></div>
      <Card className="appearance-settings-card">
        <div className="appearance-setting-row"><div><strong>Default file open destination</strong><span>Choose the application used when opening a file from a message or workspace result.</span></div><Dropdown value={fileOpenDestination} options={fileOpenDestinationOptions} onChange={value => { const next = value as FileOpenDestination; setFileOpenDestination(next); void update({ defaultFileOpenDestination: next }); }} disabled={busy} aria-label="Default file open destination" /></div>
      </Card>
    </section>
    <section className="appearance-section">
      <div className="appearance-section-heading"><div><h2>Context</h2><p>Choose whether the composer shows the selected model's context usage.</p></div></div>
      <Card className="appearance-settings-card">
        <div className="appearance-setting-row"><div><strong>Show context window usage</strong><span>Display the current context window usage beside the model selector.</span></div><ToggleSwitch label="Show context window usage" checked={showContextWindowUsage} disabled={busy} onChange={next => { setShowContextWindowUsage(next); void update({ showContextWindowUsage: next }); }} /></div>
      </Card>
    </section>
  </div>;
}
