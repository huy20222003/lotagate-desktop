import { Check, Copy } from 'lucide-react';
import { useClipboard } from '../../hooks/use-clipboard.js';
import { cn } from '../../utils/cn.js';
import { Tooltip } from './Tooltip.js';

export function CopyTextButton({ content, label }: { content: string; label: string }) {
  const { copy, status } = useClipboard();
  const copied = status === 'copied';
  const tooltipLabel = status === 'error' ? 'Copy failed' : copied ? 'Copied' : label;
  return <Tooltip label={tooltipLabel}><button type="button" className={cn('agent-copy-button', 'icon-button', 'ui-icon-button')} aria-label={label} onClick={() => void copy(content)}>{copied ? <Check size={13} /> : <Copy size={13} />}</button></Tooltip>;
}
