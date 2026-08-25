import type { IpcMainInvokeEvent } from 'electron';

export function assertTrustedRenderer(event: IpcMainInvokeEvent): void {
  const url = event.senderFrame?.url ?? '';
  if (url.startsWith('file://') || url.startsWith('http://localhost:')) return;
  throw new Error('Untrusted renderer sender.');
}
