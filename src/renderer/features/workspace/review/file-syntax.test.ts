import { describe, expect, it } from 'vitest';
import { highlightFileContent, languageForPath } from './file-syntax.js';

describe('file syntax highlighting', () => {
  it('maps common file names to the matching language grammar', () => {
    expect(languageForPath('package.json')).toBe('json');
    expect(languageForPath('src/main.ts')).toBe('typescript');
    expect(languageForPath('Dockerfile')).toBe('docker');
  });

  it('returns themed tokens with VS Code-compatible colors', async () => {
    const lines = await highlightFileContent('{"name":"lotagate"}', 'package.json', 'dark-plus');
    const tokens = lines.flat();

    expect(tokens.length).toBeGreaterThan(0);
    expect(tokens.some(token => token.color !== undefined)).toBe(true);
    expect(tokens.map(token => token.content).join('')).toBe('{"name":"lotagate"}');
  });
});
