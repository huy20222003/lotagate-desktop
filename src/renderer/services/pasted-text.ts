export const PASTED_TEXT_ATTACHMENT_THRESHOLD = 600;
export const PASTED_TEXT_ATTACHMENT_NAME = 'pasted-file.txt';
export const PASTED_TEXT_PROMPT = 'Please review the attached pasted text.';

export function isLongPastedText(value: string): boolean {
  return Array.from(value).length >= PASTED_TEXT_ATTACHMENT_THRESHOLD;
}

export function pastedTextPreview(value: string | undefined, maxLength = 72): string | undefined {
  if (value === undefined) return undefined;
  const firstLine = value.split(/\r?\n/u, 1)[0]?.trim();
  if (!firstLine) return undefined;
  const characters = Array.from(firstLine);
  return characters.length > maxLength ? `${characters.slice(0, maxLength - 1).join('')}…` : firstLine;
}
