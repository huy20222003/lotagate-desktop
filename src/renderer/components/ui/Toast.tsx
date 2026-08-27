import { CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { Icon } from './Icon.js';
import { cn } from '../../utils/cn.js';
import type { ToastMessage } from './ToastTypes.js';

export function Toast({ message, onClose }: { message: ToastMessage; onClose: () => void }) {
  const StatusIcon = message.tone === 'success' ? CheckCircle2 : message.tone === 'error' ? XCircle : Info;
  return <article className={`toast toast-${message.tone}`} role={message.tone === 'error' ? 'alert' : 'status'}><Icon icon={StatusIcon} size={16} /><div><strong>{message.title}</strong>{message.detail ? <p>{message.detail}</p> : null}</div><button type="button" className={cn('icon-button', 'ui-icon-button')} aria-label="Dismiss notification" onClick={onClose}><Icon icon={X} size={14} /></button></article>;
}
