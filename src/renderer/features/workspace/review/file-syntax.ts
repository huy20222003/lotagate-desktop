import type { CSSProperties } from 'react';
import { createHighlighter, createJavaScriptRegexEngine, type BundledLanguage, type SpecialLanguage, type ThemedToken } from 'shiki';

export type CodeTheme = 'dark-plus' | 'light-plus';

const highlighterPromise = createHighlighter({
  langs: ['c', 'cpp', 'csharp', 'css', 'docker', 'go', 'html', 'java', 'javascript', 'json', 'jsx', 'make', 'markdown', 'powershell', 'python', 'rust', 'scss', 'shellscript', 'sql', 'tsx', 'typescript', 'vue', 'xml', 'yaml'],
  themes: ['dark-plus', 'light-plus'],
  engine: createJavaScriptRegexEngine(),
});

export function languageForPath(path: string): BundledLanguage | SpecialLanguage {
  const name = path.split(/[\\/]/u).at(-1)?.toLowerCase() ?? '';
  const extension = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : '';
  if (name === 'dockerfile') return 'docker';
  if (name === 'makefile') return 'make';
  const languages: Record<string, BundledLanguage> = {
    c: 'c', cpp: 'cpp', cs: 'csharp', css: 'css', go: 'go', html: 'html', java: 'java', js: 'javascript',
    json: 'json', jsx: 'jsx', md: 'markdown', mjs: 'javascript', py: 'python', ps1: 'powershell', rs: 'rust',
    scss: 'scss', sh: 'shellscript', sql: 'sql', svg: 'xml', ts: 'typescript', tsx: 'tsx', vue: 'vue', xml: 'xml',
    yaml: 'yaml', yml: 'yaml',
  };
  return languages[extension] ?? 'text';
}

export async function highlightFileContent(content: string, path: string, theme: CodeTheme): Promise<ThemedToken[][]> {
  const highlighter = await highlighterPromise;
  return highlighter.codeToTokens(content, { lang: languageForPath(path), theme, tokenizeMaxLineLength: 2_000 }).tokens;
}

export function tokenStyle(token: ThemedToken, includeBackground = true): CSSProperties {
  const style: CSSProperties = {};
  if (token.color !== undefined) style.color = token.color;
  if (includeBackground && token.bgColor !== undefined) style.backgroundColor = token.bgColor;
  const fontStyle = Number(token.fontStyle ?? 0);
  if ((fontStyle & 1) !== 0) style.fontStyle = 'italic';
  if ((fontStyle & 2) !== 0) style.fontWeight = 700;
  if ((fontStyle & 4) !== 0) style.textDecoration = 'underline';
  return style;
}
