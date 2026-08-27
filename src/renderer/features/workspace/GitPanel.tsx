import { useCallback, useEffect, useMemo, useState } from 'react';
import { GitBranch, GitCommitHorizontal, RefreshCw, RotateCcw, Upload, Download, X } from 'lucide-react';
import type { GitBranch as GitBranchInfo, GitCommit, GitFileChange, GitRepositorySnapshot, GitStash } from '../../../contracts/ipc/v1/workspace.js';
import { Button, TextArea, TextInput, Tooltip } from '../../components/ui.js';
import { Scrollbar } from '../../components/Scrollbar.js';
import { toUserErrorMessage as toMessage } from '../../utils/errors.js';
import { useResizableSidePanel } from './use-resizable-panel.js';

type GitPanelTab = 'changes' | 'history' | 'stashes';

export function GitPanel({ cwd, onClose }: { cwd: string; onClose: () => void }) {
  const { panelWidth, resizing, startResize, handleResizeKeyDown } = useResizableSidePanel();
  const [tab, setTab] = useState<GitPanelTab>('changes');
  const [snapshot, setSnapshot] = useState<GitRepositorySnapshot>();
  const [branches, setBranches] = useState<GitBranchInfo[]>([]);
  const [history, setHistory] = useState<GitCommit[]>([]);
  const [stashes, setStashes] = useState<GitStash[]>([]);
  const [selectedPath, setSelectedPath] = useState<string>();
  const [selectedDiff, setSelectedDiff] = useState<string>();
  const [commitMessage, setCommitMessage] = useState('');
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();

  const reload = useCallback(async () => {
    setBusy('refresh');
    setError(undefined);
    try {
      const [nextSnapshot, nextBranches, nextHistory, nextStashes] = await Promise.all([
        window.lotagate.git.status(cwd),
        window.lotagate.git.branchList(cwd),
        window.lotagate.git.history(cwd, 30),
        window.lotagate.git.stashList(cwd),
      ]);
      setSnapshot(nextSnapshot);
      setBranches(nextBranches);
      setHistory(nextHistory);
      setStashes(nextStashes);
      if (selectedPath !== undefined && !nextSnapshot.changes.some(change => change.path === selectedPath)) {
        setSelectedPath(undefined);
        setSelectedDiff(undefined);
      }
    } catch (reason) {
      setError(toMessage(reason));
    } finally {
      setBusy(undefined);
    }
  }, [cwd, selectedPath]);

  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => {
    const unsubscribe = window.lotagate.agent.onEvent(envelope => {
      if (envelope.cwd !== cwd) return;
      const event = envelope.event.event;
      if (event === 'turn.completed' || event === 'turn.failed' || event === 'turn.cancelled' || event.startsWith('file.')) void reload();
    });
    const refreshOnFocus = () => { void reload(); };
    window.addEventListener('focus', refreshOnFocus);
    return () => { unsubscribe(); window.removeEventListener('focus', refreshOnFocus); };
  }, [cwd, reload]);

  const openDiff = useCallback(async (change: GitFileChange) => {
    setSelectedPath(change.path);
    setSelectedDiff(undefined);
    if (change.directory) {
      setSelectedDiff('This change is a directory and cannot be opened as a file.');
      return;
    }
    try {
      const diff = await window.lotagate.git.fileDiff(cwd, change.path, change.staged);
      setSelectedDiff(diff || (change.unstaged ? await window.lotagate.git.readFile(cwd, change.path) : 'No diff available for this file.'));
    } catch (reason) {
      setSelectedDiff(toMessage(reason));
    }
  }, [cwd]);

  const runAction = useCallback(async (name: string, action: () => Promise<unknown>) => {
    setBusy(name);
    setError(undefined);
    try { await action(); await reload(); }
    catch (reason) { setError(toMessage(reason)); }
    finally { setBusy(undefined); }
  }, [reload]);

  const stageChanges = useMemo(() => snapshot?.changes.filter(change => change.staged) ?? [], [snapshot]);
  const unstagedChanges = useMemo(() => snapshot?.changes.filter(change => !change.staged && change.status !== 'ignored') ?? [], [snapshot]);
  const currentBranch = branches.find(branch => branch.current)?.name ?? snapshot?.branch ?? (snapshot?.detached ? 'Detached HEAD' : 'No branch');
  const canCommit = commitMessage.trim().length > 0 && stageChanges.length > 0 && busy === undefined;
  const switchBranch = useCallback((branch: string) => {
    if (!branch || branch === currentBranch) return;
    const confirmed = snapshot?.clean ?? true ? true : window.confirm('This worktree has uncommitted changes. Switch branch anyway?');
    if (confirmed) void runAction(`checkout:${branch}`, () => window.lotagate.git.checkout(cwd, branch, confirmed));
  }, [currentBranch, cwd, runAction, snapshot?.clean]);
  const createBranch = useCallback(() => {
    const branch = window.prompt('New branch name');
    if (branch?.trim()) void runAction(`create-branch:${branch}`, () => window.lotagate.git.createBranch(cwd, branch.trim()));
  }, [cwd, runAction]);

  return <aside className={`git-panel${resizing ? ' is-resizing' : ''}`} style={{ width: `${panelWidth}px` }} aria-label="Git"><div className="git-panel-resize-handle" role="separator" aria-label="Resize Git panel" aria-orientation="vertical" tabIndex={0} onPointerDown={startResize} onKeyDown={handleResizeKeyDown} /><header className="git-panel-header"><div className="git-panel-title"><GitBranch size={16} /><strong>{snapshot?.repositoryName ?? 'Git'}</strong><span>{currentBranch}</span></div><div className="git-panel-actions"><Tooltip label="Refresh Git status"><button type="button" className="icon-button ui-icon-button" aria-label="Refresh Git status" onClick={() => void reload()} disabled={busy !== undefined}><RefreshCw size={15} className={busy === 'refresh' ? 'spin' : undefined} /></button></Tooltip><button type="button" className="icon-button ui-icon-button" aria-label="Close Git panel" onClick={onClose}><X size={16} /></button></div></header><div className="git-panel-tabs" role="tablist" aria-label="Git views"><button type="button" role="tab" aria-selected={tab === 'changes'} className={tab === 'changes' ? 'active' : ''} onClick={() => setTab('changes')}>Changes <span>{snapshot?.changes.length ?? 0}</span></button><button type="button" role="tab" aria-selected={tab === 'history'} className={tab === 'history' ? 'active' : ''} onClick={() => setTab('history')}>History</button><button type="button" role="tab" aria-selected={tab === 'stashes'} className={tab === 'stashes' ? 'active' : ''} onClick={() => setTab('stashes')}>Stashes <span>{stashes.length}</span></button></div>{error ? <p className="git-panel-error" role="alert">{error}</p> : null}<div className="git-panel-toolbar"><select className="git-branch-select" aria-label="Current Git branch" value={snapshot?.branch ?? ''} onChange={event => switchBranch(event.target.value)} disabled={busy !== undefined || branches.length === 0}>{snapshot?.detached ? <option value="">Detached HEAD</option> : null}{branches.map(branch => <option value={branch.name} key={branch.name}>{branch.name}{branch.ahead || branch.behind ? ` ↑${branch.ahead} ↓${branch.behind}` : ''}</option>)}</select><Button className="git-toolbar-button" onClick={createBranch} disabled={busy !== undefined}><GitBranch size={14} />New branch</Button><Button className="git-toolbar-button" onClick={() => void runAction('fetch', () => window.lotagate.git.fetch(cwd))} disabled={busy !== undefined}><Download size={14} />Fetch</Button><Button className="git-toolbar-button" onClick={() => void runAction('pull', () => window.lotagate.git.pull(cwd))} disabled={busy !== undefined}><Download size={14} />Pull</Button><Button className="git-toolbar-button" onClick={() => { if (window.confirm('Push the current branch to its remote?')) void runAction('push', () => window.lotagate.git.push(cwd, true)); }} disabled={busy !== undefined}><Upload size={14} />Push</Button></div>{tab === 'changes' ? <Scrollbar className="git-panel-scroll"><div className="git-panel-content"><GitChangeGroup title="Staged Changes" changes={stageChanges} actionLabel="Unstage" onFile={openDiff} onAction={change => void runAction(`unstage:${change.path}`, () => window.lotagate.git.unstage(cwd, change.path))} /><GitChangeGroup title="Changes" changes={unstagedChanges} actionLabel="Stage" onFile={openDiff} onAction={change => void runAction(`stage:${change.path}`, () => window.lotagate.git.stage(cwd, change.path))} onSecondaryAction={change => { if (window.confirm(`Discard changes in ${change.path}?`)) void runAction(`restore:${change.path}`, () => window.lotagate.git.restore(cwd, change.path, true)); }} /><div className="git-group-actions"><Button onClick={() => void runAction('stage-all', () => window.lotagate.git.stageAll(cwd))} disabled={busy !== undefined || unstagedChanges.length === 0}>Stage all</Button><Button onClick={() => void runAction('unstage-all', () => window.lotagate.git.unstageAll(cwd))} disabled={busy !== undefined || stageChanges.length === 0}>Unstage all</Button></div>{snapshot?.conflicts ? <p className="git-conflict-warning">{snapshot.conflicts} conflict{snapshot.conflicts === 1 ? '' : 's'} need resolution.</p> : null}<section className="git-commit-box"><label htmlFor="git-commit-message">Commit message</label><TextArea id="git-commit-message" value={commitMessage} onChange={event => setCommitMessage(event.target.value)} placeholder="Describe your changes" maxLength={500} rows={3} /><Button variant="primary" onClick={() => void runAction('commit', async () => { await window.lotagate.git.commit(cwd, commitMessage); setCommitMessage(''); })} disabled={!canCommit}><GitCommitHorizontal size={14} />Commit {stageChanges.length ? `${stageChanges.length} file${stageChanges.length === 1 ? '' : 's'}` : ''}</Button></section>{selectedPath ? <section className="git-selected-diff"><header><strong title={selectedPath}>{selectedPath}</strong><button type="button" className="icon-button ui-icon-button" aria-label="Close file diff" onClick={() => { setSelectedPath(undefined); setSelectedDiff(undefined); }}><X size={14} /></button></header><pre>{selectedDiff ?? 'Loading diff…'}</pre></section> : null}</div></Scrollbar> : tab === 'history' ? <Scrollbar className="git-panel-scroll"><div className="git-panel-content"><GitHistory commits={history} /></div></Scrollbar> : <Scrollbar className="git-panel-scroll"><div className="git-panel-content"><GitStashes stashes={stashes} cwd={cwd} busy={busy} onAction={runAction} /></div></Scrollbar>}</aside>;
}

function GitChangeGroup({ title, changes, actionLabel, onFile, onAction, onSecondaryAction }: { title: string; changes: GitFileChange[]; actionLabel: string; onFile: (change: GitFileChange) => void; onAction: (change: GitFileChange) => void; onSecondaryAction?: ((change: GitFileChange) => void) | undefined }) {
  return <section className="git-change-group"><header><strong>{title}</strong><span>{changes.length}</span></header>{changes.length === 0 ? <p className="git-empty">No files</p> : <div className="git-change-list">{changes.map(change => <div className="git-change-row" key={`${change.path}:${change.indexStatus}:${change.worktreeStatus}`}>{change.directory ? <span className="git-change-file git-change-directory" aria-disabled="true" title="Directories cannot be opened as a file"><span className={`git-status-dot git-status-${change.status}`} aria-hidden="true" />{change.originalPath ? `${change.originalPath} → ${change.path}` : change.path}</span> : <button type="button" className="git-change-file" onClick={() => onFile(change)} title={change.path}><span className={`git-status-dot git-status-${change.status}`} aria-hidden="true" />{change.originalPath ? `${change.originalPath} → ${change.path}` : change.path}</button>}{onSecondaryAction ? <button type="button" className="git-change-action git-change-action-danger" onClick={() => onSecondaryAction(change)}>Discard</button> : null}<button type="button" className="git-change-action" onClick={() => onAction(change)}>{actionLabel}</button></div>)}</div>}</section>;
}

function GitHistory({ commits }: { commits: GitCommit[] }) {
  if (commits.length === 0) return <p className="git-empty">No commits yet.</p>;
  return <section className="git-history-list">{commits.map(commit => <article className="git-history-row" key={commit.hash}><GitCommitHorizontal size={15} /><div><strong>{commit.subject}</strong><span>{commit.shortHash} · {commit.author} · {formatGitDate(commit.authoredAt)}</span></div></article>)}</section>;
}

function GitStashes({ stashes, cwd, busy, onAction }: { stashes: GitStash[]; cwd: string; busy?: string | undefined; onAction: (name: string, action: () => Promise<unknown>) => Promise<void> }) {
  const [message, setMessage] = useState('');
  return <section className="git-stash-list"><div className="git-stash-create"><TextInput value={message} onChange={event => setMessage(event.target.value)} placeholder="Optional stash message" maxLength={500} /><Button onClick={() => void onAction('stash-save', async () => { await window.lotagate.git.stashSave(cwd, message); setMessage(''); })} disabled={busy !== undefined}><RotateCcw size={14} />Stash</Button></div>{stashes.length === 0 ? <p className="git-empty">No stashes.</p> : stashes.map(stash => <div className="git-stash-row" key={stash.reference}><span><strong>{stash.reference}</strong>{stash.message}</span><div><Button onClick={() => void onAction(`stash-apply:${stash.reference}`, () => window.lotagate.git.stashApply(cwd, stash.reference))} disabled={busy !== undefined}>Apply</Button><Button variant="danger" onClick={() => { if (window.confirm(`Drop ${stash.reference}?`)) void onAction(`stash-drop:${stash.reference}`, () => window.lotagate.git.stashDrop(cwd, stash.reference, true)); }} disabled={busy !== undefined}>Drop</Button></div></div>)}</section>;
}

function formatGitDate(value: string): string { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString(); }
