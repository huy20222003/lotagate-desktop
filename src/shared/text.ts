export function formatTextClamp(maxCharacters: number, value: string): string {
  if (!Number.isFinite(maxCharacters) || maxCharacters < 0 || value.length <= maxCharacters) return value;
  return `${value.slice(0, Math.floor(maxCharacters)).trimEnd()}....`;
}

export function takeWords(maxWords: number, value: string): string {
  if (!Number.isFinite(maxWords) || maxWords < 0) return '';
  const normalized = value.replace(/\s+/gu, ' ').trim();
  if (normalized.length === 0) return '';
  return normalized.split(' ').slice(0, Math.floor(maxWords)).join(' ');
}
