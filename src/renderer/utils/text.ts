export function formatTextClamp(maxCharacters: number, value: string): string {
  if (!Number.isFinite(maxCharacters) || maxCharacters < 0 || value.length <= maxCharacters) return value;
  return `${value.slice(0, Math.floor(maxCharacters)).trimEnd()}....`;
}
