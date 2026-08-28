import { CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { Icon } from './Icon.js';
import type { ToastMessage } from './ToastTypes.js';
import { IconButton } from './IconButton.js';

export function Toast({ message, onClose }: { message: ToastMessage; onClose: () => void }) {
  const StatusIcon = message.tone === 'success' ? CheckCircle2 : message.tone === 'error' ? XCircle : Info;
  return <article className={`toast toast-${message.tone}`} role={message.tone === 'error' ? 'alert' : 'status'}><Icon icon={StatusIcon} size={16} /><div><strong>{message.title}</strong>{message.detail ? <p>{message.detail}</p> : null}</div><IconButton icon={X} iconSize={14} label="Dismiss notification" onClick={onClose} /></article>;
}
