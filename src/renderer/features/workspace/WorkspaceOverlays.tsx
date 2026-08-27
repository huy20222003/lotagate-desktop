import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { ChevronDown, ChevronRight, Columns2, FileCode2, FileText, Folder, FolderOpen, List, LoaderCircle, Minus, Plus, ShieldCheck, X } from 'lucide-react';
import type { ApprovalRequest, FileChangeDiff, FileChangeSummary, WorkspaceFileSuggestion } from '../../../contracts/ipc/v1/workspace.js';
import { Button, Card, CopyTextButton, Icon, Tabs, Tooltip } from '../../components/ui.js';
import { Scrollbar } from '../../components/Scrollbar.js';
import { toUserErrorMessage as toMessage } from '../../utils/errors.js';

export function InlineApproval({ request, onDecision }: { request: ApprovalRequest; onDecision: (approved: boolean) => Promise<void> }) {
  const [submitting, setSubmitting] = useState(false);
  const allowButtonRef = useRef<HTMLButtonElement>(null);
  const denyButtonRef = useRef<HTMLButtonElement>(null);
  const action = request.displayName.trim().toLowerCase();
  const decide = async (approved: boolean) => {
    if (submitting) return;
    setSubmitting(true);
    try { await onDecision(approved); } finally { setSubmitting(false); }
  };
  const moveDecisionFocus = (direction: 'next' | 'previous') => {
    const active = document.activeElement;
    const next = direction === 'next'
      ? active === allowButtonRef.current ? denyButtonRef.current : allowButtonRef.current
      : active === denyButtonRef.current ? allowButtonRef.current : denyButtonRef.current;
    next?.focus();
  };
  return <section className="composer-approval" role="alertdialog" aria-labelledby="composer-approval-title" aria-describedby="composer-approval-summary" aria-busy={submitting} onKeyDown={event => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      moveDecisionFocus(event.key === 'ArrowDown' ? 'next' : 'previous');
    }
  }}>
    <div className="composer-approval-header">
      <strong id="composer-approval-title">Do you want to allow {action || 'this action'}?</strong>
      <p id="composer-approval-summary">{approvalSummary(request)}</p>
    </div>
    <div className="composer-approval-options" role="group" aria-label="Approval decision">
      <Button ref={allowButtonRef} variant="primary" autoFocus disabled={submitting} onClick={() => void decide(true)}>Yes, allow</Button>
      <Button ref={denyButtonRef} variant="secondary" disabled={submitting} onClick={() => void decide(false)}>No, deny</Button>
    </div>
  </section>;
}

function approvalSummary(request: ApprovalRequest): string {
  const summary = request.detail['summary'];
  if (typeof summary === 'string' && summary.trim().length > 0) return summary;
  const path = request.detail['path'];
  if (typeof path === 'string' && path.trim().length > 0) return `Workspace path: ${path}`;
  const command = request.detail['command'];
  if (typeof command === 'string' && command.trim().length > 0) return `Command: ${command}`;
  return 'This action needs your approval before the agent can continue.';
}

const REVIEW_TAB = 'review';
const FILE_TAB_PREFIX = 'file:';
const FILE_PANEL_DEFAULT_WIDTH = 520;
const FILE_PANEL_MIN_WIDTH = 360;
const FILE_PANEL_MAX_WIDTH = 900;

interface OpenFileState { status: 'loading' | 'ready' | 'error'; content?: string; error?: string; }

export function FileChangesDrawer({ cwd, summary, onClose }: { cwd: string; summary: FileChangeSummary; onClose: () => void }) {
  const [panelWidth, setPanelWidth] = useState(FILE_PANEL_DEFAULT_WIDTH);
  const [resizing, setResizing] = useState(false);
  const resizeStart = useRef<{ clientX: number; width: number } | undefined>(undefined);
  const [activeTab, setActiveTab] = useState(REVIEW_TAB);
  const [openFiles, setOpenFiles] = useState<Record<string, OpenFileState>>({});
  const [viewMode, setViewMode] = useState<DiffViewMode>('unified');
  const nextViewMode: DiffViewMode = viewMode === 'unified' ? 'split' : 'unified';
  const nextViewLabel = nextViewMode === 'split' ? 'Side-by-side diff' : 'Unified diff';
  const NextViewIcon = nextViewMode === 'split' ? Columns2 : List;
  const tabItems = useMemo(() => [{ value: REVIEW_TAB, label: 'Review' }, ...Object.keys(openFiles).map(path => ({ value: fileTabValue(path), label: fileName(path) }))], [openFiles]);
  useEffect(() => {
    setActiveTab(current => { const path = filePathFromTab(current); return current === REVIEW_TAB || (path !== undefined && openFiles[path] !== undefined) ? current : REVIEW_TAB; });
  }, [openFiles]);
  const openFile = useCallback(async (path: string) => {
    setActiveTab(fileTabValue(path));
    if (openFiles[path] !== undefined) return;
    setOpenFiles(current => ({ ...current, [path]: { status: 'loading' } }));
    try {
      const content = await window.lotagate.git.readFile(cwd, path);
      setOpenFiles(current => ({ ...current, [path]: { status: 'ready', content } }));
    } catch (reason) {
      setOpenFiles(current => ({ ...current, [path]: { status: 'error', error: toMessage(reason) } }));
    }
  }, [cwd, openFiles]);
  const closeFile = useCallback((value: string) => {
    const path = filePathFromTab(value);
    if (path === undefined) return;
    setOpenFiles(current => { const next = { ...current }; delete next[path]; return next; });
    setActiveTab(current => current === value ? REVIEW_TAB : current);
  }, []);
  const resizePanel = useCallback((clientX: number) => {
    const start = resizeStart.current;
    if (!start) return;
    const availableWidth = Math.max(FILE_PANEL_MIN_WIDTH, Math.floor(window.innerWidth * 0.75));
    setPanelWidth(clamp(start.width - (clientX - start.clientX), FILE_PANEL_MIN_WIDTH, Math.min(FILE_PANEL_MAX_WIDTH, availableWidth)));
  }, []);
  useEffect(() => {
    if (!resizing) return;
    const move = (event: PointerEvent) => resizePanel(event.clientX);
    const stop = () => { resizeStart.current = undefined; setResizing(false); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop, { once: true });
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', stop); };
  }, [resizePanel, resizing]);
  const startResize = (event: ReactPointerEvent<HTMLDivElement>) => { event.preventDefault(); resizeStart.current = { clientX: event.clientX, width: panelWidth }; setResizing(true); };
  const handleResizeKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const delta = event.key === 'ArrowLeft' ? 16 : -16;
    setPanelWidth(current => clamp(current + delta, FILE_PANEL_MIN_WIDTH, FILE_PANEL_MAX_WIDTH));
  };
  const activePath = filePathFromTab(activeTab);
  const activeFile = activePath === undefined ? undefined : openFiles[activePath];
  const tabClose = tabItems.length > 1 ? { onClose: closeFile } : {};
  const fileContent = activeFile === undefined ? {} : { file: activeFile };
  return <aside className={`file-changes-panel${resizing ? ' is-resizing' : ''}`} style={{ width: `${panelWidth}px` }} aria-label="Changed files"><div className="file-changes-resize-handle" role="separator" aria-label="Resize changed files panel" aria-orientation="vertical" tabIndex={0} onPointerDown={startResize} onKeyDown={handleResizeKeyDown} /><header className="file-changes-panel-header"><div className="file-changes-tab-strip"><Tabs value={activeTab} items={tabItems} onChange={setActiveTab} {...tabClose} ariaLabel="Changed file views" /></div><div className="file-changes-header-actions"><Tooltip label={nextViewLabel}><button type="button" className="icon-button ui-icon-button" aria-label={nextViewLabel} onClick={() => setViewMode(nextViewMode)}><NextViewIcon size={16} /></button></Tooltip><button type="button" className="icon-button ui-icon-button" aria-label="Close changed files" onClick={onClose}><X size={16} /></button></div></header><div className="file-changes-summary"><strong>Last Turn</strong><span className="change-additions">+{summary.additions}</span><span className="change-deletions">-{summary.deletions}</span></div>{activeTab === REVIEW_TAB ? <Scrollbar className="file-changes-list"><div className="file-review-list">{summary.files.length === 0 ? <p className="file-changes-empty">No changed files in this turn.</p> : summary.files.map(change => <FileChangeItem key={change.path} change={change} viewMode={viewMode} showActions onOpenFile={() => void openFile(change.path)} />)}</div></Scrollbar> : <FileContentTab cwd={cwd} path={activePath ?? ''} {...fileContent} onOpenPath={path => void openFile(path)} />}</aside>;
}

function clamp(value: number, minimum: number, maximum: number): number { return Math.min(Math.max(value, minimum), maximum); }

export function FileChangeCard({ summary, onOpenFileChanges }: { summary: FileChangeSummary; onOpenFileChanges: (summary: FileChangeSummary) => void }) {
  return <section className="file-change-card" aria-label="Edited files"><header><div><strong>Edited {summary.files.length} {summary.files.length === 1 ? 'file' : 'files'}</strong><span><b className="change-additions">+{summary.additions}</b><b className="change-deletions">-{summary.deletions}</b></span></div></header><div className="file-change-card-list">{summary.files.map(change => <FileChangeItem key={change.path} change={change} onOpenFileChanges={() => onOpenFileChanges(summary)} />)}</div></section>;
}

export type DiffViewMode = 'unified' | 'split';
function FileChangeItem({ change, onOpenFileChanges, onOpenFile, viewMode = 'unified', showActions = false }: { change: FileChangeDiff; onOpenFileChanges?: () => void; onOpenFile?: () => void; viewMode?: DiffViewMode; showActions?: boolean }) {
  const [expanded, setExpanded] = useState(true);
  const expandable = onOpenFileChanges === undefined;
  return <section className="file-change-item"><header>{expandable ? <button type="button" className="file-change-toggle" aria-label={`${expanded ? 'Collapse' : 'Expand'} changes for ${change.path}`} aria-expanded={expanded} onClick={() => setExpanded(current => !current)}>{expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</button> : null}{onOpenFileChanges ? <button type="button" className="file-change-path" title={change.path} onClick={onOpenFileChanges}>{change.path}</button> : <strong title={change.path}>{change.path}</strong>}<span><Plus size={12} />{change.additions}<Minus size={12} />{change.deletions}</span>{showActions ? <div className="file-change-actions"><CopyTextButton content={change.path} label="Copy path" /><Tooltip label={expanded ? 'Collapse file' : 'Expand file'}><button type="button" className="icon-button ui-icon-button" aria-label={expanded ? `Collapse changes for ${change.path}` : `Expand changes for ${change.path}`} aria-expanded={expanded} onClick={() => setExpanded(current => !current)}>{expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</button></Tooltip><Tooltip label="Open file in a tab"><button type="button" className="icon-button ui-icon-button" aria-label={`Open ${change.path} in a tab`} onClick={onOpenFile}><FileCode2 size={14} /></button></Tooltip></div> : null}</header>{expandable && expanded ? <FileChangeDiffContent change={change} viewMode={viewMode} /> : null}</section>;
}

function FileChangeDiffContent({ change, viewMode = 'unified' }: { change: FileChangeDiff; viewMode?: DiffViewMode }) {
  if (viewMode === 'split') return <FileChangeSplitDiff change={change} />;
  return <CollapsibleUnifiedDiff change={change} />;
}

const CONTEXT_PREVIEW_LINES = 3;
function CollapsibleUnifiedDiff({ change }: { change: FileChangeDiff }) {
  const [expandedBlocks, setExpandedBlocks] = useState<Set<number>>(new Set());
  const output: ReactNode[] = [];
  for (let index = 0; index < change.lines.length;) {
    const line = change.lines[index];
    if (line?.kind !== 'context') {
      if (line !== undefined) output.push(renderDiffLine(change.path, line, index));
      index += 1;
      continue;
    }
    const start = index;
    while (change.lines[index]?.kind === 'context') index += 1;
    const end = index;
    const count = end - start;
    const blockKey = start;
    const expanded = expandedBlocks.has(blockKey);
    const lines = expanded || count <= CONTEXT_PREVIEW_LINES * 2 + 1 ? change.lines.slice(start, end) : [...change.lines.slice(start, start + CONTEXT_PREVIEW_LINES), ...change.lines.slice(end - CONTEXT_PREVIEW_LINES, end)];
    lines.forEach((context, offset) => { const originalIndex = expanded || count <= CONTEXT_PREVIEW_LINES * 2 + 1 ? start + offset : offset < CONTEXT_PREVIEW_LINES ? start + offset : end - CONTEXT_PREVIEW_LINES + offset - CONTEXT_PREVIEW_LINES; output.push(renderDiffLine(change.path, context!, originalIndex)); });
    if (!expanded && count > CONTEXT_PREVIEW_LINES * 2 + 1) output.push(<button type="button" className="diff-context-toggle" key={`${change.path}:context:${blockKey}`} onClick={() => setExpandedBlocks(current => { const next = new Set(current); next.add(blockKey); return next; })}>{count - CONTEXT_PREVIEW_LINES * 2} unmodified lines</button>);
  }
  return <pre>{output}{change.truncated ? <code className="diff-truncated">… diff truncated …</code> : null}</pre>;
}

function renderDiffLine(path: string, line: FileChangeDiff['lines'][number], index: number) {
  return <code className={`diff-line diff-${line.kind}`} key={`${path}:${index}`}><span className="diff-line-number">{line.newLine ?? line.oldLine ?? ''}</span><span>{line.kind === 'deletion' ? '-' : ' '}{line.text}</span></code>;
}

function FileChangeSplitDiff({ change }: { change: FileChangeDiff }) {
  return <div className="diff-split-scroll"><div className="diff-split">{splitDiffLines(change.lines).map((row, index) => <div className="diff-split-row" key={`${change.path}:split:${index}`}><DiffSide line={row.left} kind="deletion" /><DiffSide line={row.right} kind="addition" /></div>)}{change.truncated ? <div className="diff-truncated">… diff truncated …</div> : null}</div></div>;
}

function DiffSide({ line, kind }: { line: FileChangeDiff['lines'][number] | undefined; kind: 'addition' | 'deletion' }) {
  return <div className={`diff-side ${line === undefined ? 'diff-side-empty' : `diff-${line.kind === 'context' ? 'context' : kind}`}`}>{line ? <><span className="diff-line-number">{kind === 'addition' ? line.newLine ?? '' : line.oldLine ?? ''}</span><span className="diff-side-text">{line.kind === 'context' ? ` ${line.text}` : `${kind === 'deletion' ? '-' : ''}${line.text}`}</span></> : null}</div>;
}

function splitDiffLines(lines: readonly FileChangeDiff['lines'][number][]): Array<{ left?: FileChangeDiff['lines'][number]; right?: FileChangeDiff['lines'][number] }> {
  const rows: Array<{ left?: FileChangeDiff['lines'][number]; right?: FileChangeDiff['lines'][number] }> = [];
  for (let index = 0; index < lines.length;) {
    const current = lines[index];
    if (current === undefined) break;
    if (current.kind === 'context') { rows.push({ left: current, right: current }); index += 1; continue; }
    const left: FileChangeDiff['lines'][number][] = [];
    const right: FileChangeDiff['lines'][number][] = [];
    if (current.kind === 'deletion') {
      while (lines[index]?.kind === 'deletion') left.push(lines[index++] as FileChangeDiff['lines'][number]);
      while (lines[index]?.kind === 'addition') right.push(lines[index++] as FileChangeDiff['lines'][number]);
    } else {
      while (lines[index]?.kind === 'addition') right.push(lines[index++] as FileChangeDiff['lines'][number]);
      while (lines[index]?.kind === 'deletion') left.push(lines[index++] as FileChangeDiff['lines'][number]);
    }
    const count = Math.max(left.length, right.length);
    for (let offset = 0; offset < count; offset += 1) rows.push({ ...(left[offset] === undefined ? {} : { left: left[offset] }), ...(right[offset] === undefined ? {} : { right: right[offset] }) });
  }
  return rows;
}

export function TrustCard({ request, onDecision }: { request: { path: string }; onDecision: (trusted: boolean) => Promise<void> }) {
  return <Card className="trust-card"><div className="approval-heading"><ShieldCheck size={18} /><strong>Trust this project?</strong></div><p>The CLI needs permission to use trusted tools in <code>{request.path}</code>.</p><div className="modal-actions"><Button variant="secondary" onClick={() => void onDecision(false)}>Reject</Button><Button variant="primary" onClick={() => void onDecision(true)}>Trust project</Button></div></Card>;
}

function FileContentTab({ cwd, path, file, onOpenPath }: { cwd: string; path: string; file?: OpenFileState; onOpenPath: (path: string) => void }) {
  const [openFolder, setOpenFolder] = useState<string | undefined>();
  const [folderItems, setFolderItems] = useState<WorkspaceFileSuggestion[]>([]);
  const [folderLoading, setFolderLoading] = useState(false);
  const folderRef = useRef<HTMLDivElement>(null);
  const relativePath = relativeWorkspacePath(cwd, path);
  const segments = relativePath.split('/').filter(Boolean);
  useEffect(() => setOpenFolder(undefined), [path]);
  useEffect(() => {
    if (openFolder === undefined) return;
    const closeOnOutsideClick = (event: PointerEvent) => { if (!folderRef.current?.contains(event.target as Node)) setOpenFolder(undefined); };
    document.addEventListener('pointerdown', closeOnOutsideClick);
    return () => document.removeEventListener('pointerdown', closeOnOutsideClick);
  }, [openFolder]);
  useEffect(() => {
    if (openFolder === undefined) return;
    let cancelled = false;
    setFolderLoading(true);
    void window.lotagate.workspaces.fileSuggestions(cwd, openFolder).then(suggestions => {
      if (!cancelled) setFolderItems(immediateFolderItems(suggestions, openFolder));
    }).catch(() => { if (!cancelled) setFolderItems([]); }).finally(() => { if (!cancelled) setFolderLoading(false); });
    return () => { cancelled = true; };
  }, [cwd, openFolder]);
  const breadcrumb = [{ label: fileName(cwd), path: '' }, ...segments.map((segment, index) => ({ label: segment, path: segments.slice(0, index + 1).join('/'), folder: index < segments.length - 1 }))];
  if (file?.status === 'loading') return <div className="file-content-state"><Icon icon={LoaderCircle} size={18} className="spin" /><span>Loading {fileName(path)}…</span></div>;
  if (file?.status === 'error') return <div className="file-content-state file-content-error"><strong>Unable to open file</strong><span>{file.error}</span></div>;
  const lines = (file?.content ?? '').replaceAll('\r\n', '\n').split('\n');
  return <div className="file-content-view"><div ref={folderRef} className="file-content-breadcrumb-wrap"><Scrollbar axis="horizontal" className="file-content-breadcrumb-scrollbar"><nav className="file-content-breadcrumb" aria-label="File path">{breadcrumb.map((item, index) => <span className="file-content-breadcrumb-item" key={item.path || item.label}>{index > 0 ? <ChevronRight size={13} aria-hidden="true" /> : null}{index < breadcrumb.length - 1 ? <button type="button" className="file-content-breadcrumb-button" aria-expanded={openFolder === item.path} onClick={() => setOpenFolder(current => current === item.path ? undefined : item.path)}>{index === 0 ? <FolderOpen size={14} /> : null}<span>{item.label}</span></button> : <span className="file-content-breadcrumb-current">{item.label}</span>}</span>)}</nav></Scrollbar>{openFolder !== undefined ? <FolderPopover items={folderItems} loading={folderLoading} onOpenFolder={setOpenFolder} onOpenFile={pathValue => { setOpenFolder(undefined); onOpenPath(pathValue); }} /> : null}</div><Scrollbar className="file-content-scroll"><pre className="file-content">{lines.map((line, index) => <code className="file-content-line" key={`${path}:${index}`}><span className="file-content-line-number">{index + 1}</span><span>{line || ' '}</span></code>)}</pre></Scrollbar></div>;
}

function FolderPopover({ items, loading, onOpenFolder, onOpenFile }: { items: WorkspaceFileSuggestion[]; loading: boolean; onOpenFolder: (path: string) => void; onOpenFile: (path: string) => void }) {
  return <div className="file-content-folder-popover" role="menu"><Scrollbar className="file-content-folder-scrollbar">{loading ? <span className="file-content-folder-state">Loading files…</span> : items.length === 0 ? <span className="file-content-folder-state">No files in this folder.</span> : <div className="file-content-folder-options">{items.map(item => <button type="button" role="menuitem" className="file-content-folder-option" key={`${item.kind}:${item.path}`} onClick={() => item.kind === 'folder' ? onOpenFolder(item.path) : onOpenFile(item.path)}>{item.kind === 'folder' ? <Folder size={14} /> : <FileText size={14} />}<span>{fileName(item.path)}</span></button>)}</div>}</Scrollbar></div>;
}

function immediateFolderItems(suggestions: WorkspaceFileSuggestion[], folder: string): WorkspaceFileSuggestion[] {
  const prefix = folder ? `${folder.replaceAll('\\', '/').replace(/\/+$/u, '')}/` : '';
  return suggestions.filter(item => item.path.startsWith(prefix) && !item.path.slice(prefix.length).includes('/'));
}

function relativeWorkspacePath(cwd: string, path: string): string {
  const normalizedCwd = cwd.replaceAll('\\', '/').replace(/\/+$/u, '');
  const normalizedPath = path.replaceAll('\\', '/');
  const prefix = `${normalizedCwd}/`;
  return normalizedPath.startsWith(prefix) ? normalizedPath.slice(prefix.length) : normalizedPath.replace(/^\/+/, '');
}

function fileTabValue(path: string): string { return `${FILE_TAB_PREFIX}${path}`; }
function filePathFromTab(value: string): string | undefined { return value.startsWith(FILE_TAB_PREFIX) ? value.slice(FILE_TAB_PREFIX.length) : undefined; }
function fileName(path: string): string { return path.split(/[\\/]/u).pop() || path; }
