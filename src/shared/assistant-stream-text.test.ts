import { describe, expect, it } from 'vitest';
import { mergeAssistantText, normalizeAssistantText } from './assistant-stream-text.js';

describe('assistant stream text', () => {
  it('supports incremental and cumulative provider fragments', () => {
    expect(mergeAssistantText('', 'Hello')).toBe('Hello');
    expect(mergeAssistantText('Hello', ' world')).toBe('Hello world');
    expect(mergeAssistantText('Hello world', 'Hello world from LotaGate')).toBe('Hello world from LotaGate');
  });

  it('collapses repeated fragments before they reach the conversation', () => {
    const fragment = 'Trang About vẫn kẹt ở "Loading". ';

    expect(mergeAssistantText('', `${fragment}${fragment}`)).toBe(fragment);
    expect(mergeAssistantText(fragment, fragment)).toBe(fragment);
    expect(normalizeAssistantText(`${fragment}${fragment}`)).toBe(fragment);
  });
});
