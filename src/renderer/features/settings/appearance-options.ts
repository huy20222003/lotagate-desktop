import { Monitor, Moon, Sun } from 'lucide-react';
import type { FontChoice, ThemePreference } from '../../theme/theme.js';

export const themeOptions: Array<{ value: ThemePreference; label: string; detail: string; icon: typeof Sun }> = [
  { value: 'system', label: 'System', detail: 'Follow the appearance setting of this device.', icon: Monitor },
  { value: 'light', label: 'Light', detail: 'A bright interface for well-lit environments.', icon: Sun },
  { value: 'dark', label: 'Dark', detail: 'A low-light interface for focused work.', icon: Moon },
];
export const fontOptions: Array<{ value: FontChoice; label: string }> = [{ value: 'inter', label: 'Inter' }, { value: 'system', label: 'System default' }, { value: 'mono', label: 'Monospace' }];
export type ThemeOption = typeof themeOptions[number];
