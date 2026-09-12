import '@xterm/xterm/css/xterm.css';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal as XTerm, type ITheme } from '@xterm/xterm';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Plus, X } from 'lucide-react';
import type { DesktopSettingsSnapshot } from '../../../../contracts/ipc/v1/settings.js';
import type { TerminalSession } from '../../../../contracts/ipc/v1/workspace.js';
import { DESKTOP_RUNTIME_LIMITS } from '../../../../contracts/runtime-limits.js';
import { IconButton, Tabs } from '../../../components/ui.js';
import { createComposerApprovalInput } from './approval-request.js';
import { useResizableBottomPanel, useResizableSidePanel } from '../state/use-resizable-panel.js';

type TerminalPreferences = Pick<DesktopSettingsSnapshot, 'terminalFontSize' | 'terminalScrollback' | 'terminalCursorBlink'>;
interface TerminalTab extends TerminalSession { label: string; preferences: TerminalPreferences; }

const defaultTerminalPreferences: TerminalPreferences = { terminalFontSize: 13, terminalScrollback: 10_000, terminalCursorBlink: true };

export function TerminalPanel({ cwd, onClose, placement = 'bottom', open = true }: { cwd: string; onClose: () => void; placement?: 'bottom' | 'right'; open?: boolean }) {
  const [tabs, setTabs] = useState<TerminalTab[]>([]);
  const [activeId, setActiveId] = useState('');
  const [error, setError] = useState<string>();
  const tabsRef = useRef<TerminalTab[]>([]);
  const currentCwdRef = useRef(cwd);
  currentCwdRef.current = cwd;
  const mountedCwdRef = useRef(cwd);
  const openingRef = useRef(false);
  const terminalsRef = useRef(new Map<string, XTerm>());
  const pendingOutputRef = useRef(new Map<string, string>());
  const { panelWidth, resizing: resizingWidth, startResize: startWidthResize, handleResizeKeyDown: handleWidthResizeKeyDown } = useResizableSidePanel();
  const { panelHeight, resizing: resizingHeight, startResize: startHeightResize, handleResizeKeyDown: handleHeightResizeKeyDown } = useResizableBottomPanel();
  const resizing = placement === 'right' ? resizingWidth : resizingHeight;

  useEffect(() => { tabsRef.current = tabs; }, [tabs]);
  useEffect(() => window.lotagate.terminal.onOutput(output => {
    const terminal = terminalsRef.current.get(output.sessionId);
    if (terminal) terminal.write(output.data);
    else pendingOutputRef.current.set(output.sessionId, appendBoundedOutput(pendingOutputRef.current.get(output.sessionId) ?? '', output.data));
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
    const requestedCwd = cwd;
    try {
      let preferences = defaultTerminalPreferences;
      try {
        const settings = await window.lotagate.settings.get();
        preferences = { terminalFontSize: settings.terminalFontSize, terminalScrollback: settings.terminalScrollback, terminalCursorBlink: settings.terminalCursorBlink };
      } catch {
        // Terminal settings are optional for opening an interactive session.
      }
      const session = await window.lotagate.terminal.open({ cwd: requestedCwd });
      if (currentCwdRef.current !== requestedCwd) {
        await window.lotagate.terminal.close(session.id).catch(() => undefined);
        return;
      }
      const folder = requestedCwd.split(/[\\/]/u).filter(Boolean).at(-1) ?? 'PowerShell';
      const existingCount = tabsRef.current.filter(tab => tab.label.startsWith(folder)).length;
      const label = existingCount === 0 ? folder : `${folder} (${existingCount + 1})`;
      setTabs(current => {
        const next = [...current, { ...session, label, preferences }];
        tabsRef.current = next;
        return next;
      });
      setActiveId(session.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to open terminal.');
    }
  }, [cwd]);
  const requestOpenTab = useCallback(async () => {
    try {
      const resolution = await window.lotagate.approvals.request(createComposerApprovalInput({ source: 'terminal', toolName: 'terminal.open', displayName: 'Open terminal', kind: 'terminal', summary: `Open an interactive terminal in ${cwd}`, workspaceCwd: cwd }));
      if (resolution.approved) await openTab();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Terminal approval failed.');
    }
  }, [cwd, openTab]);

  useEffect(() => {
    if (mountedCwdRef.current === cwd) return;
    mountedCwdRef.current = cwd;
    openingRef.current = false;
    pendingOutputRef.current.clear();
    const previousTabs = tabsRef.current;
    tabsRef.current = [];
    setTabs([]);
    setActiveId('');
    for (const tab of previousTabs) void window.lotagate.terminal.close(tab.id).catch(() => undefined);
  }, [cwd]);

  useEffect(() => {
    if (!open || tabsRef.current.length > 0 || openingRef.current) return;
    openingRef.current = true;
    void requestOpenTab().finally(() => { openingRef.current = false; });
  }, [open, requestOpenTab]);

  useEffect(() => () => {
    for (const tab of tabsRef.current) void window.lotagate.terminal.close(tab.id).catch(() => undefined);
    tabsRef.current = [];
    pendingOutputRef.current.clear();
  }, []);

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

  const panelStyle = placement === 'right' ? { width: `${panelWidth}px` } : { height: `${panelHeight}px` };
  const resizeHandle = placement === 'right'
    ? <div className="terminal-panel-resize-handle terminal-panel-resize-handle-side" role="separator" aria-label="Resize terminal width" aria-orientation="vertical" tabIndex={0} onPointerDown={startWidthResize} onKeyDown={handleWidthResizeKeyDown} />
    : <div className="terminal-panel-resize-handle terminal-panel-resize-handle-bottom" role="separator" aria-label="Resize terminal height" aria-orientation="horizontal" tabIndex={0} onPointerDown={startHeightResize} onKeyDown={handleHeightResizeKeyDown} />;
  return <section className={`terminal-panel${placement === 'right' ? ' terminal-panel-right' : ''}${resizing ? ' is-resizing' : ''}`} style={panelStyle} aria-label="Terminal" hidden={!open}>{resizeHandle}<header className="terminal-panel-header"><div className="terminal-tab-strip">{tabs.length > 0 ? <Tabs value={activeId} items={tabs.map(tab => ({ value: tab.id, label: tab.label }))} onChange={setActiveId} onClose={closeTab} ariaLabel="Terminal tabs" /> : null}</div><div className="terminal-panel-actions"><IconButton icon={Plus} iconSize={15} label="New terminal" onClick={() => void requestOpenTab()} /><IconButton icon={X} iconSize={15} label="Close terminal" onClick={onClose} /></div></header>{error ? <p className="terminal-error">{error}</p> : null}<div className="terminal-output">{tabs.map(tab => <TerminalSessionView key={tab.id} sessionId={tab.id} active={tab.id === activeId} preferences={tab.preferences} onReady={registerTerminal} onDispose={unregisterTerminal} onError={handleError} />)}</div></section>;
}

function TerminalSessionView({ sessionId, active, preferences, onReady, onDispose, onError }: { sessionId: string; active: boolean; preferences: TerminalPreferences; onReady: (sessionId: string, terminal: XTerm) => void; onDispose: (sessionId: string) => void; onError: (message: string) => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const fitRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const terminal = new XTerm({
      cursorBlink: preferences.terminalCursorBlink,
      convertEol: false,
      fontFamily: terminalFontFamily(),
      fontSize: preferences.terminalFontSize,
      lineHeight: 1.25,
      letterSpacing: 0,
      fontWeight: 400,
      fontWeightBold: 600,
      scrollback: preferences.terminalScrollback,
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

function terminalTheme(): ITheme {
  const styles = getComputedStyle(document.documentElement);
  const value = (name: string, fallback: string) => styles.getPropertyValue(name).trim() || fallback;
  return {
    background: value('--color-canvas', '#10151c'),
    foreground: value('--color-text-secondary', '#d4d4d4'),
    cursor: value('--color-accent', '#5ba7d8'),
    selectionBackground: value('--color-selection', '#264f78'),
    black: value('--terminal-ansi-black', '#0f141a'),
    red: value('--terminal-ansi-red', '#e06c75'),
    green: value('--terminal-ansi-green', '#86c991'),
    yellow: value('--terminal-ansi-yellow', '#d6b574'),
    blue: value('--terminal-ansi-blue', '#5ba7d8'),
    magenta: value('--terminal-ansi-magenta', '#c2a0e6'),
    cyan: value('--terminal-ansi-cyan', '#65c5c0'),
    white: value('--terminal-ansi-white', '#dbe4ec'),
    brightBlack: value('--terminal-ansi-bright-black', '#6f7b89'),
    brightRed: value('--terminal-ansi-bright-red', '#ff9da3'),
    brightGreen: value('--terminal-ansi-bright-green', '#b7e3bd'),
    brightYellow: value('--terminal-ansi-bright-yellow', '#f0d99b'),
    brightBlue: value('--terminal-ansi-bright-blue', '#79b8ff'),
    brightMagenta: value('--terminal-ansi-bright-magenta', '#e0c5ff'),
    brightCyan: value('--terminal-ansi-bright-cyan', '#9be6df'),
    brightWhite: value('--terminal-ansi-bright-white', '#ffffff'),
  };
}

function terminalFontFamily(): string {
  return '"Cascadia Mono", "Cascadia Code", Consolas, "Courier New", Menlo, Monaco, monospace';
}

function appendBoundedOutput(existing: string, next: string): string {
  const combined = `${existing}${next}`;
  if (new TextEncoder().encode(combined).byteLength <= DESKTOP_RUNTIME_LIMITS.terminalPendingOutputBytes) return combined;
  const marker = '\r\n[terminal output truncated]\r\n';
  let result = '';
  for (const character of combined) {
    const candidate = `${result}${character}${marker}`;
    if (new TextEncoder().encode(candidate).byteLength > DESKTOP_RUNTIME_LIMITS.terminalPendingOutputBytes) break;
    result += character;
  }
  return `${result}${marker}`;
}
