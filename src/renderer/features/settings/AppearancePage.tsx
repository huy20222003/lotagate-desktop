import { useEffect, useState } from 'react';
import { Check, Monitor, Moon, Sun } from 'lucide-react';
import { Button, Card, Checkbox, Dropdown, useToast } from '../../components/ui.js';
import { useTheme, type FontChoice, type ThemeColor, type ThemePreference } from '../../theme/theme.js';

const themeOptions: Array<{ value: ThemePreference; label: string; detail: string; icon: typeof Sun }> = [
  { value: 'system', label: 'System', detail: 'Follow the appearance setting of this device.', icon: Monitor },
  { value: 'light', label: 'Light', detail: 'A bright interface for well-lit environments.', icon: Sun },
  { value: 'dark', label: 'Dark', detail: 'A low-light interface for focused work.', icon: Moon },
];

const fontOptions: Array<{ value: FontChoice; label: string }> = [
  { value: 'inter', label: 'Inter' },
  { value: 'system', label: 'System default' },
  { value: 'mono', label: 'Monospace' },
];

export function AppearancePage() {
  const { preference, setTheme, reducedMotion, setReducedMotion, contrast, setContrast, uiFont, setUiFont, codeFont, setCodeFont, colors, setColor } = useTheme();
  const { error } = useToast();
  const [motionBusy, setMotionBusy] = useState(false);
  const [contrastDraft, setContrastDraft] = useState(contrast);

  useEffect(() => setContrastDraft(contrast), [contrast]);

  const reportError = (title: string, reason: unknown) => error(title, reason instanceof Error ? reason.message : 'Please try again.');
  const selectTheme = async (next: ThemePreference) => { try { await setTheme(next); } catch (reason) { reportError('Unable to update appearance', reason); } };
  const updateMotion = async (next: boolean) => {
    setMotionBusy(true);
    try { await setReducedMotion(next); } catch (reason) { reportError('Unable to update motion preference', reason); }
    finally { setMotionBusy(false); }
  };
  const updateColor = async (color: ThemeColor, value: string) => {
    try { await setColor(color, value); } catch (reason) { reportError('Unable to update color', reason); }
  };
  const resetColor = async (color: ThemeColor) => {
    try { await setColor(color, undefined); } catch (reason) { reportError('Unable to reset color', reason); }
  };
  const updateFont = async (kind: 'ui' | 'code', value: string) => {
    try { if (kind === 'ui') await setUiFont(value as FontChoice); else await setCodeFont(value as FontChoice); } catch (reason) { reportError('Unable to update font', reason); }
  };
  const commitContrast = () => { void setContrast(contrastDraft).catch(reason => reportError('Unable to update contrast', reason)); };
  const colorValue = (color: ThemeColor) => colors[color] ?? readThemeColor(color);

  return <div className="appearance-page">
    <section className="appearance-section">
      <div className="appearance-section-heading"><div><h2>Theme</h2><p>Choose how LotaGate looks on this device.</p></div><Button variant="ghost" onClick={() => { void Promise.all((['accent', 'background', 'foreground'] as ThemeColor[]).map(color => resetColor(color))); }}>Reset colors</Button></div>
      <div className="theme-options" role="radiogroup" aria-label="Theme">
        {themeOptions.map(option => <ThemeOption key={option.value} option={option} selected={preference === option.value} onSelect={() => void selectTheme(option.value)} />)}
      </div>
    </section>
    <section className="appearance-section appearance-settings-card">
      <div className="appearance-section-heading"><div><h2>{themeOptions.find(option => option.value === preference)?.label ?? 'Theme'} theme</h2><p>Customize the visual language of the workspace.</p></div></div>
      <ColorSetting label="Accent" value={colorValue('accent')} custom={colors.accent !== undefined} onChange={value => void updateColor('accent', value)} onReset={() => void resetColor('accent')} />
      <ColorSetting label="Background" value={colorValue('background')} custom={colors.background !== undefined} onChange={value => void updateColor('background', value)} onReset={() => void resetColor('background')} />
      <ColorSetting label="Foreground" value={colorValue('foreground')} custom={colors.foreground !== undefined} onChange={value => void updateColor('foreground', value)} onReset={() => void resetColor('foreground')} />
      <FontSetting label="UI font" value={uiFont} onChange={value => void updateFont('ui', value)} />
      <FontSetting label="Code font" value={codeFont} onChange={value => void updateFont('code', value)} />
      <div className="appearance-setting-row appearance-contrast-row"><div><strong>Contrast</strong><span>Adjust the contrast of the interface.</span></div><div className="contrast-control"><input type="range" min="0" max="100" step="1" value={contrastDraft} aria-label="Contrast" onChange={event => setContrastDraft(Number(event.target.value))} onPointerUp={commitContrast} /><output>{contrastDraft}</output></div></div>
    </section>
    <section className="appearance-section">
      <div className="appearance-section-heading"><div><h2>Interface</h2><p>Adjust accessibility and motion preferences.</p></div></div>
      <Card className="appearance-setting-row"><div><strong>Reduce motion</strong><span>Minimize animations throughout the desktop application.</span></div><Checkbox label="Reduce motion" checked={reducedMotion} onChange={next => void updateMotion(next)} /></Card>
      {motionBusy ? <p className="appearance-setting-note">Saving…</p> : null}
    </section>
  </div>;
}

function ThemeOption({ option, selected, onSelect }: { option: typeof themeOptions[number]; selected: boolean; onSelect: () => void }) {
  const Icon = option.icon;
  return <button type="button" role="radio" aria-checked={selected} className={`theme-option ${selected ? 'selected' : ''}`} onClick={onSelect}>
    <span className={`theme-preview theme-preview-${option.value}`} aria-hidden="true"><span /><span /><span /></span>
    <span className="theme-option-copy"><strong><Icon size={15} /> {option.label}</strong><small>{option.detail}</small></span>
    {selected ? <Check className="theme-option-check" size={16} /> : null}
  </button>;
}

function ColorSetting({ label, value, custom, onChange, onReset }: { label: string; value: string; custom: boolean; onChange: (value: string) => void; onReset: () => void }) {
  return <div className="appearance-setting-row appearance-color-row"><div><strong>{label}</strong><span>{custom ? 'Custom color' : 'Theme default'}</span></div><div className="appearance-color-control"><input type="color" value={value} aria-label={label} onChange={event => onChange(event.target.value)} /><code>{value.toUpperCase()}</code>{custom ? <Button variant="ghost" onClick={onReset}>Reset</Button> : null}</div></div>;
}

function FontSetting({ label, value, onChange }: { label: string; value: FontChoice; onChange: (value: string) => void }) {
  return <div className="appearance-setting-row appearance-font-row"><div><strong>{label}</strong><span>Font used in the {label === 'UI font' ? 'interface' : 'code editor and previews'}.</span></div><Dropdown value={value} options={fontOptions} aria-label={label} onChange={onChange} /></div>;
}

function readThemeColor(color: ThemeColor): string {
  const token = color === 'background' ? '--color-canvas' : color === 'foreground' ? '--color-text' : '--color-accent';
  return getComputedStyle(document.documentElement).getPropertyValue(token).trim();
}
