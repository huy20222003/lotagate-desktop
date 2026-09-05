interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
  prerelease: string[];
}

export function compareDesktopVersions(left: string, right: string): number {
  const a = parseDesktopVersion(left);
  const b = parseDesktopVersion(right);
  for (const key of ['major', 'minor', 'patch'] as const) {
    if (a[key] !== b[key]) return a[key] > b[key] ? 1 : -1;
  }
  if (a.prerelease.length === 0 && b.prerelease.length > 0) return 1;
  if (a.prerelease.length > 0 && b.prerelease.length === 0) return -1;
  for (let index = 0; index < Math.max(a.prerelease.length, b.prerelease.length); index += 1) {
    const leftPart = a.prerelease[index];
    const rightPart = b.prerelease[index];
    if (leftPart === undefined) return -1;
    if (rightPart === undefined) return 1;
    if (leftPart === rightPart) continue;
    const leftNumber = numericIdentifier(leftPart);
    const rightNumber = numericIdentifier(rightPart);
    if (leftNumber !== undefined && rightNumber !== undefined) return leftNumber > rightNumber ? 1 : -1;
    if (leftNumber !== undefined) return -1;
    if (rightNumber !== undefined) return 1;
    return leftPart > rightPart ? 1 : -1;
  }
  return 0;
}

export function isDesktopVersionNewer(candidate: string, current: string): boolean {
  return compareDesktopVersions(candidate, current) > 0;
}

export function isDesktopVersionBelow(candidate: string, minimum: string): boolean {
  return compareDesktopVersions(candidate, minimum) < 0;
}

export function isValidDesktopVersion(value: string): boolean {
  try {
    parseDesktopVersion(value);
    return true;
  } catch {
    return false;
  }
}

function parseDesktopVersion(value: string): ParsedVersion {
  const match = value.trim().match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u);
  if (!match) throw new Error(`Invalid desktop version: ${value}`);
  if (![match[1], match[2], match[3]].every(part => part !== undefined && Number.isSafeInteger(Number(part)))) throw new Error(`Invalid desktop version: ${value}`);
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]), prerelease: match[4]?.split('.') ?? [] };
}

function numericIdentifier(value: string): number | undefined {
  if (!/^\d+$/u.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}
