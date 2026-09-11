/**
 * Merges an assistant stream fragment while protecting the persisted and
 * optimistic projections from cumulative or replayed provider chunks.
 */
export function mergeAssistantText(previousText: string, incomingDelta: string): string {
  if (incomingDelta.length === 0) return previousText;
  const candidate = incomingDelta.startsWith(previousText) ? incomingDelta.slice(previousText.length) : incomingDelta;
  const normalized = collapseRepeatedSequence(candidate);
  if (normalized.length === 0) return previousText;
  if (previousText.endsWith(normalized) && isReplayBoundary(normalized)) return previousText;
  return `${previousText}${normalized}`;
}

export function normalizeAssistantText(text: string): string {
  return mergeAssistantText('', text);
}

function collapseRepeatedSequence(value: string): string {
  if (value.length < 2) return value;
  const prefixTable = new Array<number>(value.length).fill(0);
  for (let index = 1; index < value.length; index += 1) {
    let border = prefixTable[index - 1] ?? 0;
    while (border > 0 && value[index] !== value[border]) border = prefixTable[border - 1] ?? 0;
    if (value[index] === value[border]) border += 1;
    prefixTable[index] = border;
  }
  const longestBorder = prefixTable.at(-1) ?? 0;
  const period = value.length - longestBorder;
  const unit = value.slice(0, period);
  return longestBorder > 0 && value.length % period === 0 && isReplayBoundary(unit) ? unit : value;
}

function isReplayBoundary(value: string): boolean {
  const lastCharacter = value.trimEnd().at(-1);
  return lastCharacter !== undefined && /[\p{P}\p{S}]/u.test(lastCharacter);
}
