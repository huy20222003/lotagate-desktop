import { describe, expect, it } from 'vitest';
import { compareDesktopVersions, isDesktopVersionBelow, isDesktopVersionNewer, isValidDesktopVersion } from './desktop-update-version.js';

describe('desktop update version comparison', () => {
  it('compares stable and prerelease versions using semver precedence', () => {
    expect(compareDesktopVersions('1.2.0', '1.1.9')).toBeGreaterThan(0);
    expect(compareDesktopVersions('1.0.0', '1.0.0-beta.2')).toBeGreaterThan(0);
    expect(compareDesktopVersions('1.0.0-beta.10', '1.0.0-beta.2')).toBeGreaterThan(0);
    expect(compareDesktopVersions('1.0.0-alpha', '1.0.0')).toBeLessThan(0);
    expect(compareDesktopVersions('1.0.0+build.2', '1.0.0+build.1')).toBe(0);
  });

  it('detects available and minimum-supported versions', () => {
    expect(isDesktopVersionNewer('0.2.0', '0.1.0')).toBe(true);
    expect(isDesktopVersionBelow('0.1.0', '0.2.0')).toBe(true);
    expect(isDesktopVersionBelow('0.2.0', '0.2.0')).toBe(false);
  });

  it('rejects versions outside the release contract', () => {
    expect(isValidDesktopVersion('0.1.0')).toBe(true);
    expect(isValidDesktopVersion('v0.1.0')).toBe(false);
    expect(isValidDesktopVersion('1.0')).toBe(false);
  });
});
