import { ArrowDown } from 'lucide-react';

export function ScrollToLatestButton({ thinking, awayFromLatest, onClick }: { thinking: boolean; awayFromLatest: boolean; onClick: () => void }) {
  return <button type="button" className={`scroll-to-bottom${thinking ? ' is-thinking' : ''}${awayFromLatest ? ' is-away' : ''}`} aria-label={thinking ? 'Agent is working; scroll to latest message' : 'Scroll to latest message'} title={thinking ? 'Agent is working' : 'Scroll to latest message'} onClick={onClick}>{thinking ? <span className="scroll-thinking-dots" aria-hidden="true"><i /><i /><i /></span> : <ArrowDown size={18} />}</button>;
}
