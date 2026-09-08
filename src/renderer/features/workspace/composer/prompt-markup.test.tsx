// @vitest-environment jsdom
import { render } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { describe, expect, it } from 'vitest';
import { applyPromptDisplayEdit, mapPromptDisplayIndexToRaw, mapPromptRawIndexToDisplay, PromptMarkup, promptInputDisplayValue, promptTokenDisplayValue } from './prompt-markup.js';

describe('PromptMarkup', () => {
  it('displays only the file name for a tagged file path', () => {
    expect(promptTokenDisplayValue('@test-md/test.md')).toBe('test.md');
    expect(promptTokenDisplayValue('@src\\components\\Button.tsx')).toBe('Button.tsx');
  });

  it('displays a root-level tagged folder without the mention marker', () => {
    expect(promptTokenDisplayValue('@todo')).toBe('todo');
    expect(promptTokenDisplayValue('https://example.com/path')).toBe('https://example.com/path');
  });

  it('keeps a shortened input value mapped to the original file reference', () => {
    const raw = '@test-md/test.md thêm nội dung';
    const display = promptInputDisplayValue(raw);
    expect(display).toBe('test.md thêm nội dung');
    expect(mapPromptDisplayIndexToRaw(raw, 'test.md'.length)).toBe('@test-md/test.md'.length);
    expect(mapPromptRawIndexToDisplay(raw, '@test-md/test.md'.length)).toBe('test.md'.length);
    expect(applyPromptDisplayEdit(raw, 'test.md thêm nội dung mới')).toBe('@test-md/test.md thêm nội dung mới');
  });

  it('renders the shortened label without changing the markup source', () => {
    const { container } = render(<PromptMarkup content="@test-md/test.md thêm nội dung" />);
    expect(container.querySelector('.prompt-token')).toHaveTextContent('test.md');
    expect(container).toHaveTextContent('test.md thêm nội dung');
  });
});
