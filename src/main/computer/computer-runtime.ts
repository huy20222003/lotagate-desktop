import type { DesktopHostCapability } from '../../contracts/agent-protocol/v1/host-capabilities.js';

/** Native Computer provider port shared by every desktop platform adapter. */
export interface ComputerRuntime {
  readonly capabilities?: DesktopHostCapability;
  execute(action: string, params: Record<string, unknown>, signal?: AbortSignal): Promise<unknown>;
  close?(): Promise<void>;
}
