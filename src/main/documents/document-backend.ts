import type { DesktopHostCapability, DesktopDocumentFormat } from '../../contracts/agent-protocol/v1/host-capabilities.js';

export interface DocumentBackendInput {
  readonly action: string;
  readonly path: string;
  readonly params: Record<string, unknown>;
}

export interface DocumentBackend {
  readonly id: string;
  readonly capabilities: Partial<Record<DesktopDocumentFormat, DesktopHostCapability>>;
  execute(cwd: string, input: DocumentBackendInput, signal?: AbortSignal): Promise<unknown>;
}
