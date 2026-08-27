import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Download, GitBranch, GitCommitHorizontal, RefreshCw, RotateCcw, Upload, X } from 'lucide-react';
import type { GitBranch as GitBranchInfo, GitCommit, GitFileChange, GitRepositorySnapshot, GitStash } from '../../../contracts/ipc/v1/workspace.js';
import { Button, Dropdown, Modal, TextArea, TextInput, Tooltip, type ButtonVariant } from '../../components/ui.js';
import { Scrollbar } from '../../components/Scrollbar.js';
import { toUserErrorMessage as toMessage } from '../../utils/errors.js';
import { useResizableSidePanel } from './use-resizable-panel.js';

type GitPanelTab = 'changes' | 'history' | 'stashes';
type GitConfirmation = { title: string; description: string; confirmLabel: string; variant: ButtonVariant; busyName: string; action: () => Promise<unknown> };

export function GitPanel({ cwd, onClose }: { cwd: string; onClose: () => void }) {
  const { panelWidth, resizing, startResize, handleResizeKeyDown } = useResizableSidePanel();
  const [tab, setTab] = useState<GitPanelTab>('changes');
  const [snapshot, setSnapshot] = useState<GitRepositorySnapshot>();
  const [branches, setBranches] = useState<GitBranchInfo[]>([]);
  const [history, setHistory] = useState<GitCommit[]>([]);
  const [stashes, setStashes] = useState<GitStash[]>([]);
  const [commitMessage, setCommitMessage] = useState('');
  const [branchDialogOpen, setBranchDialogOpen] = useState(false);
  const [branchName, setBranchName] = useState('');
  const [branchError, setBranchError] = useState<string>();
  const [confirmation, setConfirmation] = useState<GitConfirmation>();
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
    } catch (reason) {
      setError(toMessage(reason));
    } finally {
      setBusy(undefined);
    }
  }, [cwd]);

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
  const branchOptions = useMemo(() => branches.map(branch => ({ value: branch.name, label: `${branch.name}${branch.ahead || branch.behind ? ` ↑${branch.ahead} ↓${branch.behind}` : ''}` })), [branches]);
  const canCommit = commitMessage.trim().length > 0 && stageChanges.length > 0 && busy === undefined;

  const requestConfirmation = useCallback((next: GitConfirmation) => setConfirmation(next), []);
  const switchBranch = useCallback((branch: string) => {
    if (!branch || branch === currentBranch) return;
    const action = () => window.lotagate.git.checkout(cwd, branch, true);
    if (snapshot?.clean ?? true) void runAction(`checkout:${branch}`, action);
    else requestConfirmation({ title: 'Switch branch?', description: `The worktree has uncommitted changes. Switch to ${branch} anyway?`, confirmLabel: 'Switch branch', variant: 'primary', busyName: `checkout:${branch}`, action });
  }, [currentBranch, cwd, requestConfirmation, runAction, snapshot?.clean]);
  const openBranchDialog = useCallback(() => { setBranchName(''); setBranchError(undefined); setBranchDialogOpen(true); }, []);
  const submitBranch = useCallback((event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalized = branchName.trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,150}$/u.test(normalized) || normalized.includes('..') || normalized.endsWith('/') || normalized.endsWith('.')) { setBranchError('Use a valid Git branch name.'); return; }
    setBranchDialogOpen(false);
    void runAction(`create-branch:${normalized}`, () => window.lotagate.git.createBranch(cwd, normalized));
  }, [branchName, cwd, runAction]);
  const requestPull = useCallback(() => requestConfirmation({ title: 'Pull from remote?', description: 'Git will fetch remote changes and update this worktree. Continue?', confirmLabel: 'Pull', variant: 'primary', busyName: 'pull', action: () => window.lotagate.git.pull(cwd) }), [cwd, requestConfirmation]);
  const requestPush = useCallback(() => requestConfirmation({ title: 'Push to remote?', description: 'Git will publish the current branch and commits to its configured remote. Continue?', confirmLabel: 'Push', variant: 'primary', busyName: 'push', action: () => window.lotagate.git.push(cwd, true) }), [cwd, requestConfirmation]);
  const requestDiscard = useCallback((change: GitFileChange) => requestConfirmation({ title: 'Discard changes?', description: `Discard local changes in ${change.path}? This cannot be undone from the Git panel.`, confirmLabel: 'Discard', variant: 'danger', busyName: `restore:${change.path}`, action: () => window.lotagate.git.restore(cwd, change.path, true) }), [cwd, requestConfirmation]);
  const requestStashDrop = useCallback((stash: GitStash) => requestConfirmation({ title: 'Drop stash?', description: `Delete ${stash.reference}? This stash cannot be recovered from the Git panel.`, confirmLabel: 'Drop stash', variant: 'danger', busyName: `stash-drop:${stash.reference}`, action: () => window.lotagate.git.stashDrop(cwd, stash.reference, true) }), [cwd, requestConfirmation]);
  const acceptConfirmation = useCallback(() => {
    if (!confirmation) return;
    const pending = confirmation;
    setConfirmation(undefined);
    void runAction(pending.busyName, pending.action);
  }, [confirmation, runAction]);

  return <>
    <aside className={`git-panel${resizing ? ' is-resizing' : ''}`} style={{ width: `${panelWidth}px` }} aria-label="Git">
      <div className="git-panel-resize-handle" role="separator" aria-label="Resize Git panel" aria-orientation="vertical" tabIndex={0} onPointerDown={startResize} onKeyDown={handleResizeKeyDown} />
      <header className="git-panel-header"><div className="git-panel-title"><GitBranch size={16} /><strong>{snapshot?.repositoryName ?? 'Git'}</strong><span>{currentBranch}</span></div><div className="git-panel-actions"><Tooltip label="Refresh Git status"><button type="button" className="icon-button ui-icon-button" aria-label="Refresh Git status" onClick={() => void reload()} disabled={busy !== undefined}><RefreshCw size={15} className={busy === 'refresh' ? 'spin' : undefined} /></button></Tooltip><button type="button" className="icon-button ui-icon-button" aria-label="Close Git panel" onClick={onClose}><X size={16} /></button></div></header>
      <div className="git-panel-tabs" role="tablist" aria-label="Git views"><button type="button" role="tab" aria-selected={tab === 'changes'} className={tab === 'changes' ? 'active' : ''} onClick={() => setTab('changes')}>Changes <span>{snapshot?.changes.length ?? 0}</span></button><button type="button" role="tab" aria-selected={tab === 'history'} className={tab === 'history' ? 'active' : ''} onClick={() => setTab('history')}>History</button><button type="button" role="tab" aria-selected={tab === 'stashes'} className={tab === 'stashes' ? 'active' : ''} onClick={() => setTab('stashes')}>Stashes <span>{stashes.length}</span></button></div>
      {error ? <p className="git-panel-error" role="alert">{error}</p> : null}
      <div className="git-panel-toolbar"><Dropdown className="git-branch-dropdown" ariaLabel="Current Git branch" value={snapshot?.branch ?? currentBranch} options={branchOptions} onChange={switchBranch} disabled={busy !== undefined || branches.length === 0} /><Button className="git-toolbar-button" onClick={openBranchDialog} disabled={busy !== undefined}><GitBranch size={14} />New branch</Button><Button className="git-toolbar-button" onClick={() => void runAction('fetch', () => window.lotagate.git.fetch(cwd))} disabled={busy !== undefined}><Download size={14} />Fetch</Button><Button className="git-toolbar-button" onClick={requestPull} disabled={busy !== undefined}><Download size={14} />Pull</Button><Button className="git-toolbar-button" onClick={requestPush} disabled={busy !== undefined}><Upload size={14} />Push</Button></div>
      {tab === 'changes' ? <Scrollbar className="git-panel-scroll"><div className="git-panel-content"><GitChangeGroup title="Staged Changes" changes={stageChanges} actionLabel="Unstage" onAction={change => void runAction(`unstage:${change.path}`, () => window.lotagate.git.unstage(cwd, change.path))} /><GitChangeGroup title="Changes" changes={unstagedChanges} actionLabel="Stage" onAction={change => void runAction(`stage:${change.path}`, () => window.lotagate.git.stage(cwd, change.path))} onSecondaryAction={requestDiscard} /><div className="git-group-actions"><Button onClick={() => void runAction('stage-all', () => window.lotagate.git.stageAll(cwd))} disabled={busy !== undefined || unstagedChanges.length === 0}>Stage all</Button><Button onClick={() => void runAction('unstage-all', () => window.lotagate.git.unstageAll(cwd))} disabled={busy !== undefined || stageChanges.length === 0}>Unstage all</Button></div>{snapshot?.conflicts ? <p className="git-conflict-warning">{snapshot.conflicts} conflict{snapshot.conflicts === 1 ? '' : 's'} need resolution.</p> : null}<section className="git-commit-box"><label htmlFor="git-commit-message">Commit message</label><TextArea id="git-commit-message" value={commitMessage} onChange={event => setCommitMessage(event.target.value)} placeholder="Describe your changes" maxLength={500} rows={3} /><Button variant="primary" onClick={() => void runAction('commit', async () => { await window.lotagate.git.commit(cwd, commitMessage); setCommitMessage(''); })} disabled={!canCommit}><GitCommitHorizontal size={14} />Commit {stageChanges.length ? `${stageChanges.length} file${stageChanges.length === 1 ? '' : 's'}` : ''}</Button></section></div></Scrollbar> : tab === 'history' ? <Scrollbar className="git-panel-scroll"><div className="git-panel-content"><GitHistory commits={history} /></div></Scrollbar> : <Scrollbar className="git-panel-scroll"><div className="git-panel-content"><GitStashes stashes={stashes} cwd={cwd} busy={busy} onAction={runAction} onConfirm={requestStashDrop} /></div></Scrollbar>}
    </aside>
    {branchDialogOpen ? <Modal title="Create branch" subtitle="Create a new local branch from the current HEAD." className="git-branch-dialog" onClose={() => setBranchDialogOpen(false)}><form className="modal-form git-branch-form" onSubmit={submitBranch}><TextInput label="Branch name" value={branchName} onChange={event => { setBranchName(event.target.value); setBranchError(undefined); }} {...(branchError === undefined ? {} : { errorText: branchError })} placeholder="feature/my-change" autoFocus maxLength={151} /><div className="modal-actions"><Button type="button" variant="secondary" onClick={() => setBranchDialogOpen(false)}>Cancel</Button><Button type="submit" variant="primary" disabled={branchName.trim().length === 0}>Create branch</Button></div></form></Modal> : null}
    {confirmation ? <Modal title={confirmation.title} onClose={() => setConfirmation(undefined)}><p className="modal-copy">{confirmation.description}</p><div className="modal-actions"><Button variant="secondary" onClick={() => setConfirmation(undefined)}>Cancel</Button><Button variant={confirmation.variant} onClick={acceptConfirmation} disabled={busy !== undefined}>{confirmation.confirmLabel}</Button></div></Modal> : null}
  </>;
}

function GitChangeGroup({ title, changes, actionLabel, onAction, onSecondaryAction }: { title: string; changes: GitFileChange[]; actionLabel: string; onAction: (change: GitFileChange) => void; onSecondaryAction?: ((change: GitFileChange) => void) | undefined }) {
  return <section className="git-change-group"><header><strong>{title}</strong><span>{changes.length}</span></header>{changes.length === 0 ? <p className="git-empty">No files</p> : <Scrollbar className="git-change-scroll"><div className="git-change-list">{changes.map(change => <div className="git-change-row" key={`${change.path}:${change.indexStatus}:${change.worktreeStatus}`}><span className="git-change-file" aria-disabled={change.directory ? 'true' : undefined} title={change.directory ? 'Directory change' : change.path}><span className={`git-status-dot git-status-${change.status}`} aria-hidden="true" />{change.originalPath ? `${change.originalPath} → ${change.path}` : change.path}</span>{onSecondaryAction ? <button type="button" className="git-change-action git-change-action-danger" onClick={() => onSecondaryAction(change)}>Discard</button> : null}<button type="button" className="git-change-action" onClick={() => onAction(change)}>{actionLabel}</button></div>)}</div></Scrollbar>}</section>;
}

function GitHistory({ commits }: { commits: GitCommit[] }) {
  if (commits.length === 0) return <p className="git-empty">No commits yet.</p>;
  return <section className="git-history-list">{commits.map(commit => <article className="git-history-row" key={commit.hash}><GitCommitHorizontal size={15} /><div><strong>{commit.subject}</strong><span>{commit.shortHash} · {commit.author} · {formatGitDate(commit.authoredAt)}</span></div></article>)}</section>;
}

function GitStashes({ stashes, cwd, busy, onAction, onConfirm }: { stashes: GitStash[]; cwd: string; busy?: string | undefined; onAction: (name: string, action: () => Promise<unknown>) => Promise<void>; onConfirm: (stash: GitStash) => void }) {
  const [message, setMessage] = useState('');
  return <section className="git-stash-list"><div className="git-stash-create"><TextInput value={message} onChange={event => setMessage(event.target.value)} placeholder="Optional stash message" maxLength={500} /><Button onClick={() => void onAction('stash-save', async () => { await window.lotagate.git.stashSave(cwd, message); setMessage(''); })} disabled={busy !== undefined}><RotateCcw size={14} />Stash</Button></div>{stashes.length === 0 ? <p className="git-empty">No stashes.</p> : stashes.map(stash => <div className="git-stash-row" key={stash.reference}><span><strong>{stash.reference}</strong>{stash.message}</span><div><Button onClick={() => void onAction(`stash-apply:${stash.reference}`, () => window.lotagate.git.stashApply(cwd, stash.reference))} disabled={busy !== undefined}>Apply</Button><Button variant="danger" onClick={() => onConfirm(stash)} disabled={busy !== undefined}>Drop</Button></div></div>)}</section>;
}

function formatGitDate(value: string): string { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString(); }
