import { useRef, useState } from 'react';
import { ChevronDown, ChevronRight, Columns2, List, Minus, Plus, ShieldCheck, X } from 'lucide-react';
import type { ApprovalRequest, FileChangeDiff, FileChangeSummary } from '../../../contracts/ipc/v1/workspace.js';
import { Button, Card, Tooltip } from '../../components/ui.js';
import { Scrollbar } from '../../components/Scrollbar.js';

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

export function FileChangesDrawer({ summary, onClose }: { summary: FileChangeSummary; onClose: () => void }) {
  const [viewMode, setViewMode] = useState<DiffViewMode>('unified');
  const nextViewMode: DiffViewMode = viewMode === 'unified' ? 'split' : 'unified';
  const nextViewLabel = nextViewMode === 'split' ? 'Side-by-side diff' : 'Unified diff';
  const NextViewIcon = nextViewMode === 'split' ? Columns2 : List;
  return <><button type="button" className="file-changes-backdrop" aria-label="Close changed files" onClick={onClose} /><aside className="file-changes-drawer" aria-label="Changed files"><header><div><strong>Changed files</strong><span>{summary.files.length} files · +{summary.additions} -{summary.deletions}</span></div><div className="file-changes-header-actions"><Tooltip label={nextViewLabel}><button type="button" className="icon-button" aria-label={nextViewLabel} onClick={() => setViewMode(nextViewMode)}><NextViewIcon size={16} /></button></Tooltip><button type="button" className="icon-button" aria-label="Close changed files" onClick={onClose}><X size={16} /></button></div></header><Scrollbar className="file-changes-list">{summary.files.map(change => <FileChangeItem key={change.path} change={change} viewMode={viewMode} />)}</Scrollbar></aside></>;
}

export function FileChangeCard({ summary, onOpenFileChanges }: { summary: FileChangeSummary; onOpenFileChanges: (summary: FileChangeSummary) => void }) {
  return <section className="file-change-card" aria-label="Edited files"><header><div><strong>Edited {summary.files.length} {summary.files.length === 1 ? 'file' : 'files'}</strong><span><b className="change-additions">+{summary.additions}</b><b className="change-deletions">-{summary.deletions}</b></span></div></header><div className="file-change-card-list">{summary.files.map(change => <FileChangeItem key={change.path} change={change} onOpenFileChanges={() => onOpenFileChanges(summary)} />)}</div></section>;
}

export type DiffViewMode = 'unified' | 'split';
function FileChangeItem({ change, onOpenFileChanges, viewMode = 'unified' }: { change: FileChangeDiff; onOpenFileChanges?: () => void; viewMode?: DiffViewMode }) {
  const [expanded, setExpanded] = useState(true);
  const expandable = onOpenFileChanges === undefined;
  return <section className="file-change-item"><header>{expandable ? <button type="button" className="file-change-toggle" aria-label={`${expanded ? 'Collapse' : 'Expand'} changes for ${change.path}`} aria-expanded={expanded} onClick={() => setExpanded(current => !current)}>{expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</button> : null}{onOpenFileChanges ? <button type="button" className="file-change-path" title={change.path} onClick={onOpenFileChanges}>{change.path}</button> : <strong title={change.path}>{change.path}</strong>}<span><Plus size={12} />{change.additions}<Minus size={12} />{change.deletions}</span></header>{expandable && expanded ? <FileChangeDiffContent change={change} viewMode={viewMode} /> : null}</section>;
}

function FileChangeDiffContent({ change, viewMode = 'unified' }: { change: FileChangeDiff; viewMode?: DiffViewMode }) {
  if (viewMode === 'split') return <FileChangeSplitDiff change={change} />;
  return <pre>{change.lines.map((line, index) => <code className={`diff-line diff-${line.kind}`} key={`${change.path}:${index}`}><span className="diff-line-number">{line.newLine ?? line.oldLine ?? ''}</span><span>{line.kind === 'deletion' ? '-' : ' '}{line.text}</span></code>)}{change.truncated ? <code className="diff-truncated">… diff truncated …</code> : null}</pre>;
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
