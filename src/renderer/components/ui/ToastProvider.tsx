import { useCallback, useState, type PropsWithChildren } from 'react';
import { ToastContext } from './ToastContext.js';
import { Toast } from './Toast.js';
import type { ToastMessage } from './ToastTypes.js';

export function ToastProvider({ children }: PropsWithChildren) {
  const [messages, setMessages] = useState<ToastMessage[]>([]);
  const dismiss = useCallback((id: string) => setMessages(current => current.filter(message => message.id !== id)), []);
  const show = useCallback((message: Omit<ToastMessage, 'id'>) => { const next = { ...message, id: crypto.randomUUID() }; setMessages(current => [...current.slice(-3), next]); window.setTimeout(() => dismiss(next.id), 5000); }, [dismiss]);
  const value = { show, success: (title: string, detail?: string) => show({ tone: 'success', title, ...(detail === undefined ? {} : { detail }) }), error: (title: string, detail?: string) => show({ tone: 'error', title, ...(detail === undefined ? {} : { detail }) }), info: (title: string, detail?: string) => show({ tone: 'info', title, ...(detail === undefined ? {} : { detail }) }) };
  return <ToastContext.Provider value={value}>{children}<div className="toast-region" aria-live="polite" aria-atomic="true">{messages.map(message => <Toast key={message.id} message={message} onClose={() => dismiss(message.id)} />)}</div></ToastContext.Provider>;
}
