import { ArrowLeft, ArrowRight, Camera, Globe2, Plus, RefreshCw, X } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import type { BrowserSessionSnapshot, BrowserTabSnapshot } from '../../../contracts/ipc/v1/workspace.js';
import { Icon, IconButton } from '../../components/ui.js';
import { Scrollbar } from '../../components/Scrollbar.js';
import { createComposerApprovalInput } from './approval-request.js';
import { useResizableSidePanel } from './use-resizable-panel.js';

export function BrowserPanel({ taskId, sessionId, cwd, onClose }: { taskId?: string; sessionId?: string; cwd?: string; onClose: () => void }) {
  const [browserSession, setBrowserSession] = useState<BrowserSessionSnapshot>();
  const [address, setAddress] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const hostRef = useRef<HTMLDivElement>(null);
  const { panelWidth, resizing, startResize, handleResizeKeyDown } = useResizableSidePanel();
  const activeTab = browserSession?.tabs.find(tab => tab.id === browserSession.activeTabId);

  useEffect(() => {
    let disposed = false;
    let activeSessionId: string | undefined;
    let ownedSessionId: string | undefined;
    const removeStateListener = window.lotagate.browser.onState(snapshot => {
      if (!disposed && snapshot.id === activeSessionId) setBrowserSession(snapshot);
    });
    const load = sessionId === undefined
      ? window.lotagate.browser.create()
      : window.lotagate.browser.list().then(snapshots => {
        const snapshot = snapshots.find(candidate => candidate.id === sessionId);
        if (snapshot === undefined) throw new Error('The agent browser session is no longer available.');
        return snapshot;
      });
    void load.then(snapshot => {
      activeSessionId = snapshot.id;
      if (sessionId === undefined) ownedSessionId = snapshot.id;
      if (!disposed) setBrowserSession(snapshot);
      else if (sessionId === undefined) void window.lotagate.browser.close(snapshot.id).catch(() => undefined);
    }).catch(reason => { if (!disposed) setError(toBrowserError(reason, 'Unable to start browser.')); });
    return () => {
      disposed = true;
      removeStateListener();
      if (ownedSessionId) void window.lotagate.browser.close(ownedSessionId).catch(() => undefined);
    };
  }, [sessionId]);

  useEffect(() => { setAddress(activeTab?.url === 'about:blank' ? '' : activeTab?.url ?? ''); }, [activeTab?.id, activeTab?.url]);

  const syncViewBounds = useCallback(() => {
    const host = hostRef.current;
    const session = browserSession;
    if (!host || !session || !activeTab) return;
    const rect = host.getBoundingClientRect();
    void window.lotagate.browser.setViewBounds(session.id, activeTab.id, { x: rect.left, y: rect.top, width: rect.width, height: rect.height }, true).catch(() => undefined);
  }, [activeTab, browserSession]);

  useLayoutEffect(() => {
    syncViewBounds();
    const host = hostRef.current;
    if (!host) return;
    const observer = new ResizeObserver(syncViewBounds);
    observer.observe(host);
    window.addEventListener('resize', syncViewBounds);
    return () => { observer.disconnect(); window.removeEventListener('resize', syncViewBounds); };
  }, [syncViewBounds]);

  const runAction = useCallback(async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(undefined);
    try { await action(); }
    catch (reason) { setError(toBrowserError(reason, 'Browser action failed.')); }
    finally { setBusy(false); }
  }, []);
  const navigate = useCallback((event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!browserSession || !activeTab || address.trim().length === 0) return;
    const value = /^https?:\/\//iu.test(address.trim()) ? address.trim() : `https://${address.trim()}`;
    void (async () => {
      const action = () => window.lotagate.browser.navigate(browserSession.id, activeTab.id, value, true);
      try {
        const resolution = await window.lotagate.approvals.request(createComposerApprovalInput({ source: 'browser', toolName: 'browser.navigate', displayName: 'Navigate browser', kind: 'browser', summary: `Navigate to ${value}`, ...(cwd === undefined ? {} : { workspaceCwd: cwd }) }));
        if (resolution.approved) await runAction(action);
      } catch (reason) { setError(toBrowserError(reason, 'Browser approval failed.')); }
    })();
  }, [activeTab, address, browserSession, cwd, runAction]);
  const createTab = useCallback(() => { if (browserSession) void runAction(async () => { await window.lotagate.browser.createTab(browserSession.id); setAddress(''); }); }, [browserSession, runAction]);
  const closeTab = useCallback((tab: BrowserTabSnapshot) => { if (browserSession) void runAction(() => window.lotagate.browser.closeTab(browserSession.id, tab.id)); }, [browserSession, runAction]);
  const selectTab = useCallback((tab: BrowserTabSnapshot) => { if (browserSession && tab.id !== browserSession.activeTabId) void runAction(() => window.lotagate.browser.selectTab(browserSession.id, tab.id)); }, [browserSession, runAction]);
  const history = useCallback((direction: 'back' | 'forward') => { if (!browserSession || !activeTab) return; const action = direction === 'back' ? window.lotagate.browser.goBack : window.lotagate.browser.goForward; void runAction(() => action(browserSession.id, activeTab.id)); }, [activeTab, browserSession, runAction]);
  const reload = useCallback(() => { if (browserSession && activeTab) void runAction(() => window.lotagate.browser.reload(browserSession.id, activeTab.id)); }, [activeTab, browserSession, runAction]);
  const captureScreenshot = useCallback(() => {
    if (!browserSession || !activeTab) return;
    void runAction(async () => {
      const screenshot = await window.lotagate.browser.screenshot(browserSession.id, activeTab.id);
      if (!taskId) return;
      const comma = screenshot.dataUrl.indexOf(',');
      if (comma < 0) throw new Error('Browser returned an invalid screenshot.');
      const bytes = Uint8Array.from(atob(screenshot.dataUrl.slice(comma + 1)), value => value.charCodeAt(0));
      await window.lotagate.tasks.createImageArtifact(taskId, `browser-screenshot-${Date.now()}.png`, bytes);
    });
  }, [activeTab, browserSession, runAction, taskId]);

  return <aside className={`browser-panel${resizing ? ' is-resizing' : ''}`} style={{ width: `${panelWidth}px` }} aria-label="Browser">
    <div className="browser-resize-handle" role="separator" aria-label="Resize browser panel" aria-orientation="vertical" tabIndex={0} onPointerDown={startResize} onKeyDown={handleResizeKeyDown} />
    <header className="browser-panel-header">
      <div className="browser-panel-heading"><span>AGENT BROWSER</span><strong>Browser</strong></div>
      <Scrollbar axis="horizontal" className="browser-tabs-scrollbar"><div className="browser-tabs" role="tablist" aria-label="Browser tabs">{browserSession?.tabs.map(tab => <div className="browser-tab-shell" key={tab.id}><button type="button" role="tab" aria-selected={tab.id === browserSession.activeTabId} className={`browser-tab${tab.id === browserSession.activeTabId ? ' is-active' : ''}`} onClick={() => selectTab(tab)}><Icon icon={Globe2} size={13} /><span title={tab.title}>{tab.title}</span></button>{browserSession.tabs.length > 1 ? <IconButton icon={X} iconSize={12} className="browser-tab-close" label={`Close ${tab.title}`} onClick={() => closeTab(tab)} /> : null}</div>)}</div></Scrollbar>
      <div className="browser-panel-actions"><IconButton icon={Camera} iconSize={15} label="Capture screenshot" disabled={!activeTab || activeTab.url === 'about:blank' || busy} onClick={captureScreenshot} /><IconButton icon={Plus} iconSize={15} label="New browser tab" onClick={createTab} /><IconButton icon={X} iconSize={16} label="Close browser" onClick={onClose} /></div>
    </header>
    <form className="browser-toolbar" onSubmit={navigate}><div className="browser-nav-actions"><IconButton icon={ArrowLeft} iconSize={15} label="Go back" disabled={!activeTab?.canGoBack || busy} onClick={() => history('back')} /><IconButton icon={ArrowRight} iconSize={15} label="Go forward" disabled={!activeTab?.canGoForward || busy} onClick={() => history('forward')} /><IconButton icon={RefreshCw} iconSize={14} label="Reload page" disabled={!activeTab || busy} onClick={reload} /></div><input className="browser-address" value={address} onChange={event => setAddress(event.target.value)} placeholder="Enter an HTTP(S) address" aria-label="Browser address" disabled={!activeTab || busy} /></form>
    <div className="browser-panel-content">{error ? <p className="browser-error" role="alert">{error}</p> : null}<div ref={hostRef} className="browser-view-host" aria-label={activeTab?.title ?? 'Browser page'}>{!activeTab || activeTab.url === 'about:blank' ? <div className="browser-empty"><Icon icon={Globe2} size={28} /><strong>Open a page</strong><span>Enter an HTTP(S) address above.</span></div> : null}</div></div>
  </aside>;
}

function toBrowserError(reason: unknown, fallback: string): string { return reason instanceof Error && reason.message.trim().length > 0 ? reason.message : fallback; }
