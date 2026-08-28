import { Check, Copy } from 'lucide-react';
import { useClipboard } from '../../hooks/use-clipboard.js';
import { IconButton } from './IconButton.js';

export function CopyTextButton({ content, label }: { content: string; label: string }) {
  const { copy, status } = useClipboard();
  const copied = status === 'copied';
  const tooltipLabel = status === 'error' ? 'Copy failed' : copied ? 'Copied' : label;
  return <IconButton icon={copied ? Check : Copy} iconSize={13} className="agent-copy-button" label={label} tooltip={tooltipLabel} onClick={() => void copy(content)} />;
}
