import { ArrowDown } from 'lucide-react';
import { Tooltip } from '../../components/ui.js';

export function ScrollToLatestButton({ thinking, awayFromLatest, onClick }: { thinking: boolean; awayFromLatest: boolean; onClick: () => void }) {
  const label = thinking ? 'Agent is working; scroll to latest message' : 'Scroll to latest message';
  return <Tooltip label={label}><button type="button" className={`scroll-to-bottom${thinking ? ' is-thinking' : ''}${awayFromLatest ? ' is-away' : ''}`} aria-label={label} onClick={onClick}>{thinking ? <span className="scroll-thinking-dots" aria-hidden="true"><i /><i /><i /></span> : <ArrowDown size={18} />}</button></Tooltip>;
}
