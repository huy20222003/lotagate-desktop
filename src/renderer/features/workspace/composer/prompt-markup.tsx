import type { ReactNode } from 'react';

const PROMPT_TOKEN_PATTERN = /(@[^\s]+|https?:\/\/[^\s]+|\/[A-Za-z0-9][^\s]*)/gu;
const PROMPT_TOKEN_EXACT_PATTERN = /^(@[^\s]+|https?:\/\/[^\s]+|\/[A-Za-z0-9][^\s]*)$/u;

export function promptTokenDisplayValue(token: string): string {
  if (!token.startsWith('@')) return token;
  const reference = token.slice(1);
  if (!reference.includes('/') && !reference.includes('\\') && !/\.[^\s./\\]+$/u.test(reference)) return token;
  return reference.split(/[\\/]/u).pop() || token;
}

export function promptInputDisplayValue(content: string): string {
  return splitPromptParts(content).map(part => {
    if (!isPromptToken(part)) return part;
    const displayValue = promptTokenDisplayValue(part);
    return displayValue;
  }).join('');
}

export function mapPromptDisplayIndexToRaw(content: string, displayIndex: number): number {
  const target = Math.max(0, displayIndex);
  let rawOffset = 0;
  let displayOffset = 0;
  for (const part of splitPromptParts(content)) {
    const displayPart = promptInputDisplayValue(part);
    const displayEnd = displayOffset + displayPart.length;
    if (target <= displayEnd) return rawOffset + mapTokenDisplayIndexToRaw(part, displayPart, Math.max(0, target - displayOffset));
    rawOffset += part.length;
    displayOffset = displayEnd;
  }
  return content.length;
}

export function mapPromptRawIndexToDisplay(content: string, rawIndex: number): number {
  const target = Math.max(0, rawIndex);
  let rawOffset = 0;
  let displayOffset = 0;
  for (const part of splitPromptParts(content)) {
    const displayPart = promptInputDisplayValue(part);
    const rawEnd = rawOffset + part.length;
    if (target <= rawEnd) return displayOffset + mapTokenRawIndexToDisplay(part, displayPart, Math.max(0, target - rawOffset));
    rawOffset = rawEnd;
    displayOffset += displayPart.length;
  }
  return promptInputDisplayValue(content).length;
}

export function applyPromptDisplayEdit(previousRaw: string, nextDisplay: string): string {
  const previousDisplay = promptInputDisplayValue(previousRaw);
  let prefix = 0;
  while (prefix < previousDisplay.length && prefix < nextDisplay.length && previousDisplay[prefix] === nextDisplay[prefix]) prefix += 1;
  let suffix = 0;
  while (previousDisplay.length - suffix > prefix && nextDisplay.length - suffix > prefix && previousDisplay[previousDisplay.length - suffix - 1] === nextDisplay[nextDisplay.length - suffix - 1]) suffix += 1;
  const previousEnd = previousDisplay.length - suffix;
  const nextEnd = nextDisplay.length - suffix;
  const rawStart = mapPromptDisplayIndexToRaw(previousRaw, prefix);
  const rawEnd = mapPromptDisplayIndexToRaw(previousRaw, previousEnd);
  return `${previousRaw.slice(0, rawStart)}${nextDisplay.slice(prefix, nextEnd)}${previousRaw.slice(rawEnd)}`;
}

export function PromptMarkup({ content }: { content: string }): ReactNode {
  const parts = content.split(PROMPT_TOKEN_PATTERN);
  return <>{parts.map((part, index) => {
    if (!PROMPT_TOKEN_EXACT_PATTERN.test(part)) return <span key={`${index}`}>{part}</span>;
    const displayValue = promptTokenDisplayValue(part);
    return <span className="prompt-token" key={`${part}-${index}`}>{displayValue}</span>;
  })}</>;
}

function splitPromptParts(content: string): string[] {
  return content.split(PROMPT_TOKEN_PATTERN);
}

function isPromptToken(value: string): boolean {
  return PROMPT_TOKEN_EXACT_PATTERN.test(value);
}

function mapTokenDisplayIndexToRaw(rawToken: string, displayToken: string, index: number): number {
  if (rawToken === displayToken || !isPromptToken(rawToken)) return Math.min(index, rawToken.length);
  if (index === 0) return 0;
  const fileNameLength = displayToken.length;
  const rawFileNameStart = rawToken.length - fileNameLength;
  return Math.min(rawToken.length, rawFileNameStart + index);
}

function mapTokenRawIndexToDisplay(rawToken: string, displayToken: string, index: number): number {
  if (rawToken === displayToken || !isPromptToken(rawToken)) return Math.min(index, displayToken.length);
  const fileNameLength = displayToken.length;
  const rawFileNameStart = rawToken.length - fileNameLength;
  if (index < rawFileNameStart) return 0;
  return Math.min(displayToken.length, index - rawFileNameStart);
}
