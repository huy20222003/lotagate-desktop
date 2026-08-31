import type { ThemeMode } from './theme.js';

interface RgbColor { red: number; green: number; blue: number; }

const DARK_CANVAS = '#10151c';
const LIGHT_CANVAS = '#f6f8fb';
const DARK_BORDER = '#3b424b';
const LIGHT_BORDER = '#c7d0da';
const WHITE = '#ffffff';
const DARK_TEXT = '#17212b';

export function customAccentProperties(accent: string, theme: ThemeMode): Record<string, string> {
  const canvas = theme === 'dark' ? DARK_CANVAS : LIGHT_CANVAS;
  const border = theme === 'dark' ? DARK_BORDER : LIGHT_BORDER;
  const darkAccent = mixHex(accent, '#000000', 0.2);
  const link = theme === 'dark' ? mixHex(accent, '#ffffff', 0.78) : darkAccent;
  const linkHover = theme === 'dark' ? mixHex(accent, '#ffffff', 0.68) : mixHex(accent, '#000000', 0.3);
  const onAccent = contrastRatio(accent, WHITE) >= contrastRatio(accent, DARK_TEXT) ? WHITE : DARK_TEXT;
  const backgroundShare = theme === 'dark' ? 0.38 : 0.16;
  const hoverShare = theme === 'dark' ? 0.52 : 0.24;
  return {
    '--custom-accent-strong': darkAccent,
    '--custom-accent-bg': mixHex(accent, canvas, backgroundShare),
    '--custom-accent-bg-hover': mixHex(accent, canvas, hoverShare),
    '--custom-border-accent': mixHex(accent, border, 0.6),
    '--custom-border-focus': mixHex(accent, border, 0.72),
    '--custom-text-link': link,
    '--custom-text-link-hover': linkHover,
    '--custom-text-link-bright': theme === 'dark' ? mixHex(accent, '#ffffff', 0.72) : mixHex(accent, '#000000', 0.24),
    '--custom-on-accent': onAccent,
    '--custom-focus-ring': alphaColor(accent, theme === 'dark' ? 0.22 : 0.2),
    '--custom-selection': alphaColor(accent, theme === 'dark' ? 0.35 : 0.25),
    '--custom-accent-glow': alphaColor(accent, theme === 'dark' ? 0.55 : 0.35),
  };
}

export function isReadableThemeColor(color: 'accent' | 'background' | 'foreground', value: string, theme: ThemeMode, colors: Partial<Record<'accent' | 'background' | 'foreground', string>>): boolean {
  if (color === 'accent') return true;
  const background = color === 'background' ? value : colors.background ?? (theme === 'dark' ? DARK_CANVAS : LIGHT_CANVAS);
  const foreground = color === 'foreground' ? value : colors.foreground ?? (theme === 'dark' ? '#e6edf3' : '#17212b');
  return contrastRatio(background, foreground) >= 4.5;
}

function parseHex(value: string): RgbColor {
  const hex = value.slice(1);
  return { red: Number.parseInt(hex.slice(0, 2), 16), green: Number.parseInt(hex.slice(2, 4), 16), blue: Number.parseInt(hex.slice(4, 6), 16) };
}

function mixHex(foreground: string, background: string, share: number): string {
  const fg = parseHex(foreground);
  const bg = parseHex(background);
  return `#${toHex(fg.red * share + bg.red * (1 - share))}${toHex(fg.green * share + bg.green * (1 - share))}${toHex(fg.blue * share + bg.blue * (1 - share))}`;
}

function alphaColor(value: string, alpha: number): string {
  const color = parseHex(value);
  return `rgb(${color.red} ${color.green} ${color.blue} / ${Math.round(alpha * 100)}%)`;
}

function toHex(value: number): string { return Math.round(value).toString(16).padStart(2, '0'); }

function contrastRatio(first: string, second: string): number {
  const firstLuminance = luminance(parseHex(first));
  const secondLuminance = luminance(parseHex(second));
  return (Math.max(firstLuminance, secondLuminance) + 0.05) / (Math.min(firstLuminance, secondLuminance) + 0.05);
}

function luminance(color: RgbColor): number {
  const channels = [color.red, color.green, color.blue].map(channel => {
    const normalized = channel / 255;
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
}
