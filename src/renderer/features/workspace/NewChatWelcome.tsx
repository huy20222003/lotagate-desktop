import type { ReactNode } from 'react';

export function NewChatWelcome({ children }: { children: ReactNode }) {
  return <div className="new-chat-welcome"><h1>LotaGate Agent</h1>{children}</div>;
}
