import { app, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron';
import { fileURLToPath } from 'node:url';
import { resolve, sep } from 'node:path';

export function assertTrustedRenderer(event: IpcMainEvent | IpcMainInvokeEvent): void {
  const url = event.senderFrame?.url ?? '';
  if (event.senderFrame !== event.sender.mainFrame) throw new Error('Only the top-level renderer may invoke desktop IPC.');
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'http:' && parsed.hostname === 'localhost' && !app.isPackaged && isExpectedDevelopmentRenderer(parsed)) return;
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

function isExpectedDevelopmentRenderer(actual: URL): boolean {
  const configured = process.env['ELECTRON_RENDERER_URL'];
  if (configured === undefined) return false;
  try {
    const expected = new URL(configured);
    return expected.protocol === 'http:' && expected.hostname === 'localhost' && actual.origin === expected.origin && actual.pathname === expected.pathname;
  } catch {
    return false;
  }
}
