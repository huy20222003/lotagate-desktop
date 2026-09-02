import { useEffect, useState } from 'react';
import type { ThemedToken } from 'shiki';
import type { Artifact } from '../../../../contracts/ipc/v1/workspace.js';
import { useTheme } from '../../../theme/theme.js';
import { highlightFileContent, tokenStyle } from '../review/file-syntax.js';
import { Scrollbar } from '../../../components/Scrollbar.js';

export function ArtifactContentViewer({ artifact, content }: { artifact: Artifact; content: string }) {
  const { theme } = useTheme();
  const [highlightedLines, setHighlightedLines] = useState<ThemedToken[][]>();
  useEffect(() => {
    let cancelled = false;
    setHighlightedLines(undefined);
    void highlightFileContent(content, artifact.name, theme === 'dark' ? 'dark-plus' : 'light-plus').then(lines => { if (!cancelled) setHighlightedLines(lines); }).catch(() => { if (!cancelled) setHighlightedLines(undefined); });
    return () => { cancelled = true; };
  }, [artifact.name, content, theme]);
  const lines = content.replaceAll('\r\n', '\n').split('\n');
  return <Scrollbar axis="both" className="source-content-scroll"><pre className="source-content"><code>{lines.map((line, index) => <span className="source-content-line" key={`${artifact.id}:${index}`}><span className="source-content-line-number">{index + 1}</span><span>{highlightedLines?.[index]?.map((token, tokenIndex) => <span key={`${artifact.id}:${index}:${tokenIndex}`} style={tokenStyle(token)}>{token.content}</span>) ?? (line || ' ')}</span></span>)}</code></pre></Scrollbar>;
}
