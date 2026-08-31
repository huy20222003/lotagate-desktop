import { useEffect, useState } from 'react';
import { Button, Card, Checkbox, Dropdown, useToast } from '../../components/ui.js';
import { useTheme, type FontChoice, type ThemeColor, type ThemePreference } from '../../theme/theme.js';
import { useLocale, type Language } from '../../i18n/locale.js';
import { themeOptions } from './appearance-options.js';
import { ThemeOption } from './ThemeOption.js';
import { ColorSetting } from './ColorSetting.js';
import { FontSetting } from './FontSetting.js';
import { isReadableThemeColor } from '../../theme/theme-colors.js';

export function AppearancePage() {
  const { theme, preference, setTheme, reducedMotion, setReducedMotion, contrast, setContrast, uiFont, setUiFont, codeFont, setCodeFont, colors, setColor } = useTheme();
  const { language, setLanguage } = useLocale();
  const { error } = useToast();
  const [motionBusy, setMotionBusy] = useState(false);
  const [contrastDraft, setContrastDraft] = useState(contrast);
  const [languageBusy, setLanguageBusy] = useState(false);

  useEffect(() => setContrastDraft(contrast), [contrast]);

  const reportError = (title: string, reason: unknown) => error(title, reason instanceof Error ? reason.message : 'Please try again.');
  const selectTheme = async (next: ThemePreference) => { try { await setTheme(next); } catch (reason) { reportError('Unable to update appearance', reason); } };
  const updateMotion = async (next: boolean) => {
    setMotionBusy(true);
    try { await setReducedMotion(next); } catch (reason) { reportError('Unable to update motion preference', reason); }
    finally { setMotionBusy(false); }
  };
  const updateColor = async (color: ThemeColor, value: string) => {
    if (!isReadableThemeColor(color, value, theme, colors)) {
      reportError('Unable to update color', 'Foreground and background colors must keep at least 4.5:1 contrast.');
      return;
    }
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
  const updateLanguage = async (next: string) => {
    setLanguageBusy(true);
    try { await setLanguage(next as Language); } catch (reason) { reportError('Unable to update language', reason); }
    finally { setLanguageBusy(false); }
  };

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
    <section className="appearance-section">
      <div className="appearance-section-heading"><div><h2>Language</h2><p>Choose the language used by the desktop interface.</p></div></div>
      <div className="appearance-setting-row appearance-font-row"><div><strong>Interface language</strong><span>Changes are saved to this device.</span></div><Dropdown value={language} options={[{ value: 'en', label: 'English' }, { value: 'vi', label: 'Tiếng Việt' }]} onChange={value => void updateLanguage(value)} disabled={languageBusy} aria-label="Interface language" /></div>
    </section>
  </div>;
}

function readThemeColor(color: ThemeColor): string {
  const token = color === 'background' ? '--color-canvas' : color === 'foreground' ? '--color-text' : '--color-accent';
  return getComputedStyle(document.documentElement).getPropertyValue(token).trim();
}
