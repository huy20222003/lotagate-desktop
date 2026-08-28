export function TypingIndicator({ label = 'Thinking' }: { label?: string }) {
  return <div className="typing-indicator" aria-live="polite" aria-label={`${label}...`}><span className="typing-label" aria-hidden="true">{label}</span><span className="typing-dots" aria-hidden="true"><i /><i /><i /></span></div>;
}
