import type { FileChangeSummary } from '../../../contracts/ipc/v1/workspace.js';

export function ChangeSummaryChip({ summary, onClick }: { summary: FileChangeSummary; onClick: () => void }) {
  return <button type="button" className="change-summary-chip" onClick={onClick}><span className="change-summary-step" aria-hidden="true" /><span>{summary.files.length} {summary.files.length === 1 ? 'file' : 'files'} changed</span><span className="change-additions">+{summary.additions}</span><span className="change-deletions">-{summary.deletions}</span></button>;
}
