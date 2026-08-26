import { app, type IpcMainInvokeEvent } from 'electron';
import { fileURLToPath } from 'node:url';
import { resolve, sep } from 'node:path';

export function assertTrustedRenderer(event: IpcMainInvokeEvent): void {
  const url = event.senderFrame?.url ?? '';
  if (event.senderFrame !== event.sender.mainFrame) throw new Error('Only the top-level renderer may invoke desktop IPC.');
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'http:' && parsed.hostname === 'localhost') return;
    if (parsed.protocol === 'file:') {
      const framePath = resolve(fileURLToPath(parsed));
      const appPath = resolve(app.getAppPath());
      if (framePath === appPath || framePath.startsWith(`${appPath}${sep}`)) return;
    }
  } catch {
    // Fall through to the common trust error.
  }
  throw new Error('Untrusted renderer sender.');
}
