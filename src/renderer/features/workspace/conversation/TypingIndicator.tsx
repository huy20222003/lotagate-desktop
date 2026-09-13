export function TypingIndicator({ label = 'Thinking' }: { label?: string }) {
  const displayLabel = label.replace(/(?:…|\.{3,})$/u, '').trimEnd();
  return <div className="typing-indicator" aria-live="polite" aria-label={`${displayLabel}...`}><span className="typing-label" aria-hidden="true">{displayLabel}</span><span className="typing-dots" aria-hidden="true"><i /><i /><i /></span></div>;
}
