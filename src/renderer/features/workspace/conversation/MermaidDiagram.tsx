import { Maximize2 } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { useTheme } from '../../../theme/theme.js';
import { CopyTextButton, IconButton } from '../../../components/ui.js';
import { Scrollbar } from '../../../components/Scrollbar.js';
import type { LightBoxMediaItem } from '../../../services/lightbox-types.js';
import { LightBox } from '../artifacts/LightBox.js';

type MermaidApi = typeof import('mermaid').default;
type RenderState = { status: 'loading' } | { status: 'ready'; src: string } | { status: 'error'; message: string };

let mermaidPromise: Promise<MermaidApi> | undefined;

export function MermaidDiagram({ definition }: { definition: string }) {
  const { theme } = useTheme();
  const renderId = `lotagate-mermaid-${useId().replace(/[^A-Za-z0-9_-]/gu, '')}`;
  const [state, setState] = useState<RenderState>({ status: 'loading' });
  const [lightBoxOpen, setLightBoxOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    void loadMermaid().then(mermaid => {
      if (cancelled) return;
      mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'base', htmlLabels: false, themeVariables: themeVariables(theme) });
      return mermaid.render(renderId, definition);
    }).then(result => {
      if (cancelled || result === undefined) return;
      setState({ status: 'ready', src: svgDataUri(result.svg) });
    }).catch(error => {
      if (!cancelled) setState({ status: 'error', message: errorMessage(error) });
    });
    return () => { cancelled = true; };
  }, [definition, renderId, theme]);

  const diagramItem: LightBoxMediaItem | undefined = state.status === 'ready' ? { id: renderId, name: 'Mermaid diagram', src: state.src, kind: 'image', downloadName: 'diagram.svg' } : undefined;
  return <div className="markdown-mermaid">
    <header><span>mermaid</span><div className="markdown-mermaid-actions"><CopyTextButton content={definition} label="Copy mermaid source" />{diagramItem ? <IconButton icon={Maximize2} iconSize={15} className="markdown-mermaid-open" label="Open mermaid diagram" onClick={() => setLightBoxOpen(true)} /> : null}</div></header>
    {state.status === 'loading' ? <div className="markdown-mermaid-status">Rendering diagram…</div> : state.status === 'error' ? <div className="markdown-mermaid-fallback"><p>Unable to render Mermaid diagram.</p><small>{state.message}</small><pre>{definition}</pre></div> : <Scrollbar className="markdown-mermaid-scrollbar"><button type="button" className="markdown-mermaid-preview" onClick={() => setLightBoxOpen(true)} aria-label="Open mermaid diagram"><img src={state.src} alt="Mermaid diagram" /></button></Scrollbar>}
    {diagramItem && lightBoxOpen ? <LightBox items={[diagramItem]} onClose={() => setLightBoxOpen(false)} /> : null}
  </div>;
}

function loadMermaid(): Promise<MermaidApi> {
  mermaidPromise ??= import('mermaid').then(module => module.default);
  return mermaidPromise;
}

function themeVariables(theme: 'light' | 'dark'): Record<string, string> {
  return theme === 'dark'
    ? { background: 'transparent', fontSize: '13px', primaryColor: '#303030', primaryTextColor: '#f0f0f0', primaryBorderColor: '#6e6e6e', lineColor: '#b9b9b9', secondaryColor: '#252525', tertiaryColor: '#1d1d1d' }
    : { background: 'transparent', fontSize: '13px', primaryColor: '#f4f6f8', primaryTextColor: '#17212b', primaryBorderColor: '#77818c', lineColor: '#52606d', secondaryColor: '#e8edf2', tertiaryColor: '#ffffff' };
}

function svgDataUri(svg: string): string { return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`; }
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : 'The diagram definition is invalid.'; }
