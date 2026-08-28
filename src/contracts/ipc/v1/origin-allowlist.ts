/**
 * Normalizes the user-facing origin allowlist representation.
 *
 * The settings UI accepts one origin per line or comma-separated origins. The
 * same parser is used at the persistence boundary so values coming from older
 * settings files and values entered in the UI have identical semantics.
 */
export function normalizeOriginAllowlist(values: readonly string[]): string[] {
  return [...new Set(values.flatMap(value => value.split(/[\r\n,]+/u).map(item => item.trim()).filter(Boolean)))];
}
