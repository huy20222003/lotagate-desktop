import '@xterm/xterm/css/xterm.css';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal as XTerm } from '@xterm/xterm';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Plus, X } from 'lucide-react';
import type { TerminalSession } from '../../../contracts/ipc/v1/workspace.js';
import { Tabs, Tooltip } from '../../components/ui.js';

interface TerminalTab extends TerminalSession { label: string; }

export function TerminalPanel({ cwd, onClose }: { cwd: string; onClose: () => void }) {
  const [tabs, setTabs] = useState<TerminalTab[]>([]);
  const [activeId, setActiveId] = useState('');
  const [error, setError] = useState<string>();
  const tabsRef = useRef<TerminalTab[]>([]);
  const terminalsRef = useRef(new Map<string, XTerm>());
  const pendingOutputRef = useRef(new Map<string, string>());

  useEffect(() => { tabsRef.current = tabs; }, [tabs]);
  useEffect(() => window.lotagate.terminal.onOutput(output => {
    const terminal = terminalsRef.current.get(output.sessionId);
    if (terminal) terminal.write(output.data);
    else pendingOutputRef.current.set(output.sessionId, `${pendingOutputRef.current.get(output.sessionId) ?? ''}${output.data}`);
  }), []);

  const registerTerminal = useCallback((sessionId: string, terminal: XTerm) => {
    terminalsRef.current.set(sessionId, terminal);
    const pending = pendingOutputRef.current.get(sessionId);
    if (pending !== undefined) { terminal.write(pending); pendingOutputRef.current.delete(sessionId); }
  }, []);
  const unregisterTerminal = useCallback((sessionId: string) => { terminalsRef.current.delete(sessionId); }, []);
  const handleError = useCallback((message: string) => setError(message), []);
  const openTab = useCallback(async () => {
    setError(undefined);
    try {
      const session = await window.lotagate.terminal.open({ cwd });
      const folder = cwd.split(/[\\/]/u).filter(Boolean).at(-1) ?? 'PowerShell';
      const existingCount = tabsRef.current.filter(tab => tab.label.startsWith(folder)).length;
      const label = existingCount === 0 ? folder : `${folder} (${existingCount + 1})`;
      setTabs(current => [...current, { ...session, label }]);
      setActiveId(session.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to open terminal.');
    }
  }, [cwd]);
  const requestOpenTab = useCallback(() => {
    void window.lotagate.approvals.request({ source: 'terminal', surface: 'composer', toolName: 'terminal.open', displayName: 'Open terminal', kind: 'terminal', detail: { summary: `Open an interactive terminal in ${cwd}` }, workspaceCwd: cwd }).then(resolution => { if (resolution.approved) return openTab(); return undefined; }).catch(reason => setError(reason instanceof Error ? reason.message : 'Terminal approval failed.'));
  }, [cwd, openTab]);

  useEffect(() => {
    requestOpenTab();
    return () => { for (const tab of tabsRef.current) void window.lotagate.terminal.close(tab.id).catch(() => undefined); };
  }, [cwd, requestOpenTab]);

  const closeTab = useCallback((id: string) => {
    void window.lotagate.terminal.close(id).catch(() => undefined);
    pendingOutputRef.current.delete(id);
    setTabs(current => {
      const index = current.findIndex(tab => tab.id === id);
      const next = current.filter(tab => tab.id !== id);
      if (id === activeId) setActiveId(next[Math.max(0, index - 1)]?.id ?? next[0]?.id ?? '');
      return next;
    });
  }, [activeId]);

  return <section className="terminal-panel" aria-label="Terminal"><header className="terminal-panel-header"><div className="terminal-tab-strip">{tabs.length > 0 ? <Tabs value={activeId} items={tabs.map(tab => ({ value: tab.id, label: tab.label }))} onChange={setActiveId} onClose={closeTab} ariaLabel="Terminal tabs" /> : null}</div><div className="terminal-panel-actions"><Tooltip label="New terminal"><button type="button" className="icon-button ui-icon-button" aria-label="New terminal" onClick={requestOpenTab}><Plus size={15} /></button></Tooltip><Tooltip label="Close terminal"><button type="button" className="icon-button ui-icon-button" aria-label="Close terminal" onClick={onClose}><X size={15} /></button></Tooltip></div></header>{error ? <p className="terminal-error">{error}</p> : null}<div className="terminal-output">{tabs.map(tab => <TerminalSessionView key={tab.id} sessionId={tab.id} active={tab.id === activeId} onReady={registerTerminal} onDispose={unregisterTerminal} onError={handleError} />)}</div></section>;
}

function TerminalSessionView({ sessionId, active, onReady, onDispose, onError }: { sessionId: string; active: boolean; onReady: (sessionId: string, terminal: XTerm) => void; onDispose: (sessionId: string) => void; onError: (message: string) => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const fitRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const terminal = new XTerm({
      cursorBlink: true,
      convertEol: false,
      fontFamily: terminalFontFamily(),
      fontSize: 13,
      lineHeight: 1.25,
      letterSpacing: 0,
      fontWeight: 400,
      fontWeightBold: 600,
      scrollback: 10_000,
      theme: terminalTheme(),
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(container);
    const fit = () => { if (container.clientWidth > 0 && container.clientHeight > 0) fitAddon.fit(); };
    fitRef.current = fit;
    const observer = new ResizeObserver(fit);
    observer.observe(container);
    const dataSubscription = terminal.onData(data => { void window.lotagate.terminal.write(sessionId, data).catch(reason => onError(reason instanceof Error ? reason.message : 'Unable to write to terminal.')); });
    const resizeSubscription = terminal.onResize(({ cols, rows }) => { void window.lotagate.terminal.resize(sessionId, cols, rows).catch(reason => onError(reason instanceof Error ? reason.message : 'Unable to resize terminal.')); });
    onReady(sessionId, terminal);
    window.requestAnimationFrame(fit);
    return () => { observer.disconnect(); dataSubscription.dispose(); resizeSubscription.dispose(); fitRef.current = () => undefined; onDispose(sessionId); terminal.dispose(); };
  }, [onDispose, onError, onReady, sessionId]);

  useEffect(() => { if (active) window.requestAnimationFrame(() => fitRef.current()); }, [active]);
  return <div ref={containerRef} className={`terminal-session-view${active ? ' is-active' : ''}`} aria-hidden={!active} />;
}

function terminalTheme(): { background: string; foreground: string; cursor: string; selectionBackground: string } {
  const styles = getComputedStyle(document.documentElement);
  const value = (name: string, fallback: string) => styles.getPropertyValue(name).trim() || fallback;
  return { background: value('--color-canvas', '#10151c'), foreground: value('--color-text-secondary', '#d4d4d4'), cursor: value('--color-accent', '#5ba7d8'), selectionBackground: value('--color-selection', '#264f78') };
}

function terminalFontFamily(): string {
  return '"Cascadia Mono", "Cascadia Code", Consolas, "Courier New", Menlo, Monaco, monospace';
}
