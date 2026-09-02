import { assertTrustedRenderer } from './sender-policy.js';
import type { IpcRegistrationContext } from './ipc-registration-context.js';

export function registerRemoteControlIpcHandlers(context: IpcRegistrationContext): void {
  const { handle, remoteControl } = context;
  handle('remoteControl.get', async event => { assertTrustedRenderer(event); return remoteControl.get(); });
  handle('remoteControl.create', async event => { assertTrustedRenderer(event); return remoteControl.create(); });
  handle('remoteControl.revoke', async event => { assertTrustedRenderer(event); await remoteControl.revoke(); });
}
