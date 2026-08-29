const PROTECTED_FENCE_PREFIX = '\uE000lotagate-fence-';
const PROTECTED_FENCE_SUFFIX = '-\uE001';

/** Keeps fenced Markdown embedded in a fenced response block as literal content. */
export function protectNestedCodeFences(content: string): string {
  const lines = content.split(/\r?\n/u);
  let outer: Fence | undefined;
  let nested: Fence | undefined;
  return lines.map(line => {
    const fence = parseFence(line);
    if (outer === undefined) {
      if (fence !== undefined) outer = fence;
      return line;
    }
    if (nested !== undefined) {
      if (isClosingFence(fence, nested)) nested = undefined;
      return fence === undefined ? line : protectFenceMarker(line, fence);
    }
    if (isClosingFence(fence, outer)) {
      outer = undefined;
      return line;
    }
    if (fence !== undefined && fence.character === outer.character && fence.info.trim().length > 0) {
      nested = fence;
      return protectFenceMarker(line, fence);
    }
    return line;
  }).join('\n');
}

export function restoreProtectedCodeFences(value: string): string {
  const pattern = new RegExp(`${escapeRegExp(PROTECTED_FENCE_PREFIX)}([\\x60~])(\\d+)${escapeRegExp(PROTECTED_FENCE_SUFFIX)}`, 'gu');
  return value.replace(pattern, (_match, character: string, length: string) => character.repeat(Number(length)));
}

function protectFenceMarker(line: string, fence: Fence): string {
  const marker = `${PROTECTED_FENCE_PREFIX}${fence.character}${fence.length}${PROTECTED_FENCE_SUFFIX}`;
  return `${line.slice(0, fence.markerStart)}${marker}${line.slice(fence.markerEnd)}`;
}

function isClosingFence(fence: Fence | undefined, opening: Fence): boolean {
  return fence !== undefined && fence.character === opening.character && fence.length >= opening.length && fence.info.trim().length === 0;
}

function parseFence(line: string): Fence | undefined {
  const match = /^(\s{0,3})([`~]{3,})(.*)$/u.exec(line);
  if (match === null) return undefined;
  const marker = match[2]!;
  const character = marker[0]! as '`' | '~';
  return { character, length: marker.length, info: match[3] ?? '', markerStart: match[1]!.length, markerEnd: match[1]!.length + marker.length };
}

function escapeRegExp(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'); }

type Fence = { character: '`' | '~'; length: number; info: string; markerStart: number; markerEnd: number };
