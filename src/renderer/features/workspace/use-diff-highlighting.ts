import { useEffect, useMemo, useState } from 'react';
import type { ThemedToken } from 'shiki';
import type { FileChangeDiff } from '../../../contracts/ipc/v1/workspace.js';
import { useTheme } from '../../theme/theme.js';
import { highlightFileContent } from './file-syntax.js';

export function useDiffHighlighting(change: FileChangeDiff): ThemedToken[][] | undefined {
  const { theme } = useTheme();
  const content = useMemo(() => change.lines.map(line => line.text).join('\n'), [change.lines]);
  const [highlightedLines, setHighlightedLines] = useState<ThemedToken[][]>();
  useEffect(() => {
    let cancelled = false;
    setHighlightedLines(undefined);
    void highlightFileContent(content, change.path, theme === 'dark' ? 'dark-plus' : 'light-plus').then(lines => { if (!cancelled) setHighlightedLines(lines); }).catch(() => { if (!cancelled) setHighlightedLines(undefined); });
    return () => { cancelled = true; };
  }, [change.path, content, theme]);
  return highlightedLines;
}
