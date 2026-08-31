import { describe, expect, it } from 'vitest';
import { customAccentProperties, isReadableThemeColor } from './theme-colors.js';

describe('theme color derivation', () => {
  it('derives the related accent roles from the selected theme and accent', () => {
    const properties = customAccentProperties('#5ba7d8', 'dark');

    expect(properties['--custom-accent-bg']).toMatch(/^#[0-9a-f]{6}$/iu);
    expect(properties['--custom-accent-bg-hover']).toMatch(/^#[0-9a-f]{6}$/iu);
    expect(properties['--custom-border-focus']).toMatch(/^#[0-9a-f]{6}$/iu);
    expect(properties['--custom-on-accent']).toBe('#17212b');
    expect(properties['--custom-selection']).toContain('rgb(');
  });

  it('chooses a light foreground for a light accent and a dark foreground for a dark accent', () => {
    expect(customAccentProperties('#ffffff', 'light')['--custom-on-accent']).toBe('#17212b');
    expect(customAccentProperties('#10151c', 'dark')['--custom-on-accent']).toBe('#ffffff');
  });

  it('rejects custom foreground/background pairs that are not readable', () => {
    expect(isReadableThemeColor('background', '#ffffff', 'light', {})).toBe(true);
    expect(isReadableThemeColor('foreground', '#ffffff', 'light', {})).toBe(false);
    expect(isReadableThemeColor('accent', '#ffffff', 'light', {})).toBe(true);
  });
});
