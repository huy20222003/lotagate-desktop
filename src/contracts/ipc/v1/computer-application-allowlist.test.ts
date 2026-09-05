import { describe, expect, it } from 'vitest';
import { computerApplicationKey, isComputerApplicationAllowed, normalizeComputerApplicationAllowlist } from './computer-application-allowlist.js';

describe('computer application allowlist', () => {
  it('normalizes comma- and newline-separated entries without duplicates', () => {
    expect(normalizeComputerApplicationAllowlist([' notepad.exe, calc.exe', 'notepad.exe\npaint.exe'])).toEqual(['notepad.exe', 'calc.exe', 'paint.exe']);
  });

  it('matches application names case-insensitively with an optional exe suffix', () => {
    expect(computerApplicationKey(' Notepad.EXE ')).toBe('notepad');
    expect(isComputerApplicationAllowed('NOTEPAD', ['notepad.exe'])).toBe(true);
    expect(isComputerApplicationAllowed('wordpad.exe', ['notepad.exe'])).toBe(false);
  });
});
