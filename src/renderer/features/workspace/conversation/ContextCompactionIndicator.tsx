export function ContextCompactionIndicator({ phase }: { phase: 'compacting' | 'compacted' | 'failed' }) {
  const label = phase === 'compacting' ? 'Context automatically compacting' : phase === 'compacted' ? 'Context automatically compacted' : 'Context automatic compaction failed';
  return <div className={`agent-status context-compaction-status context-compaction-${phase}`} aria-live="polite">{label}{phase === 'compacting' ? <strong className="context-compaction-dots" aria-hidden="true">...</strong> : null}</div>;
}
