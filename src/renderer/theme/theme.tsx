import { createContext, useCallback, useContext, useEffect, useMemo, useState, type PropsWithChildren } from 'react';

export type ThemeMode = 'light' | 'dark';
export type ThemePreference = 'system' | ThemeMode;
export type FontChoice = 'inter' | 'system' | 'mono';
export type ThemeColor = 'accent' | 'background' | 'foreground';

interface ThemeContextValue {
  theme: ThemeMode;
  preference: ThemePreference;
  setTheme: (theme: ThemePreference) => Promise<void>;
  reducedMotion: boolean;
  setReducedMotion: (reduced: boolean) => Promise<void>;
  contrast: number;
  setContrast: (contrast: number) => Promise<void>;
  uiFont: FontChoice;
  setUiFont: (font: FontChoice) => Promise<void>;
  codeFont: FontChoice;
  setCodeFont: (font: FontChoice) => Promise<void>;
  colors: Partial<Record<ThemeColor, string>>;
  setColor: (color: ThemeColor, value: string | undefined) => Promise<void>;
}

const ThemeContext = createContext<ThemeContextValue>({ theme: 'dark', preference: 'system', setTheme: async () => undefined, reducedMotion: false, setReducedMotion: async () => undefined, contrast: 60, setContrast: async () => undefined, uiFont: 'inter', setUiFont: async () => undefined, codeFont: 'system', setCodeFont: async () => undefined, colors: {}, setColor: async () => undefined });

export function ThemeProvider({ children }: PropsWithChildren) {
  const [preference, setPreference] = useState<ThemePreference>('system');
  const [systemTheme, setSystemTheme] = useState<ThemeMode>(readSystemTheme);
  const [reducedMotion, setReducedMotionState] = useState(false);
  const [contrast, setContrastState] = useState(60);
  const [uiFont, setUiFontState] = useState<FontChoice>('inter');
  const [codeFont, setCodeFontState] = useState<FontChoice>('system');
  const [colors, setColors] = useState<Partial<Record<ThemeColor, string>>>({});

  const theme = preference === 'system' ? systemTheme : preference;

  useEffect(() => {
    void window.lotagate.settings.get().then(settings => {
      const loaded = settings['appearance'];
      if (loaded === 'system' || loaded === 'light' || loaded === 'dark') setPreference(loaded);
      if (typeof settings['reducedMotion'] === 'boolean') setReducedMotionState(settings['reducedMotion']);
      if (typeof settings['contrast'] === 'number' && Number.isInteger(settings['contrast'])) setContrastState(clampContrast(settings['contrast']));
      if (settings['uiFont'] === 'inter' || settings['uiFont'] === 'system' || settings['uiFont'] === 'mono') setUiFontState(settings['uiFont']);
      if (settings['codeFont'] === 'inter' || settings['codeFont'] === 'system' || settings['codeFont'] === 'mono') setCodeFontState(settings['codeFont']);
      setColors(readColors(settings));
    }).catch(() => undefined);
  }, []);

  useEffect(() => {
    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!media) return;
    const update = () => setSystemTheme(media.matches ? 'dark' : 'light');
    update();
    media.addEventListener?.('change', update);
    return () => media.removeEventListener?.('change', update);
  }, []);

  useEffect(() => {
    document.documentElement.dataset['theme'] = theme;
  }, [theme]);
  useEffect(() => {
    document.documentElement.dataset['reducedMotion'] = reducedMotion ? 'true' : 'false';
  }, [reducedMotion]);

  const setTheme = useCallback(async (next: ThemePreference) => {
    await window.lotagate.settings.update({ appearance: next });
    setPreference(next);
  }, []);
  const setReducedMotion = useCallback(async (next: boolean) => {
    await window.lotagate.settings.update({ reducedMotion: next });
    setReducedMotionState(next);
  }, []);
  const setContrast = useCallback(async (next: number) => {
    const normalized = clampContrast(next);
    await window.lotagate.settings.update({ contrast: normalized });
    setContrastState(normalized);
  }, []);
  const setUiFont = useCallback(async (next: FontChoice) => {
    await window.lotagate.settings.update({ uiFont: next });
    setUiFontState(next);
  }, []);
  const setCodeFont = useCallback(async (next: FontChoice) => {
    await window.lotagate.settings.update({ codeFont: next });
    setCodeFontState(next);
  }, []);
  useEffect(() => {
    document.documentElement.style.setProperty('--ui-contrast', String(0.85 + contrast / 400));
    document.documentElement.style.setProperty('--font-ui', fontStack(uiFont));
    document.documentElement.style.setProperty('--font-code', fontStack(codeFont));
    for (const color of ['accent', 'background', 'foreground'] as ThemeColor[]) {
      const value = colors[color];
      if (value === undefined) document.documentElement.style.removeProperty(`--custom-${color}`);
      else document.documentElement.style.setProperty(`--custom-${color}`, value);
    }
  }, [codeFont, colors, contrast, uiFont]);
  const setColor = useCallback(async (color: ThemeColor, next: string | undefined) => {
    const key = `${color}Color`;
    await window.lotagate.settings.update({ [key]: next });
    setColors(current => ({ ...current, ...(next === undefined ? { [color]: undefined } : { [color]: next }) }));
  }, []);
  const value = useMemo(() => ({ theme, preference, setTheme, reducedMotion, setReducedMotion, contrast, setContrast, uiFont, setUiFont, codeFont, setCodeFont, colors, setColor }), [codeFont, colors, contrast, preference, reducedMotion, setCodeFont, setColor, setContrast, setReducedMotion, setTheme, setUiFont, theme, uiFont]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}

function readSystemTheme(): ThemeMode {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}


function clampContrast(value: number): number { return Math.min(100, Math.max(0, Math.round(value))); }

function fontStack(choice: FontChoice): string {
  if (choice === 'mono') return 'ui-monospace, SFMono-Regular, Consolas, monospace';
  if (choice === 'system') return 'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  return 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
}

function readColors(settings: { accentColor?: unknown; backgroundColor?: unknown; foregroundColor?: unknown }): Partial<Record<ThemeColor, string>> {
  const colors: Partial<Record<ThemeColor, string>> = {};
  for (const color of ['accent', 'background', 'foreground'] as ThemeColor[]) {
    const value = settings[`${color}Color`];
    if (typeof value === 'string' && /^#[0-9a-f]{6}$/iu.test(value)) colors[color] = value;
  }
  return colors;
}
