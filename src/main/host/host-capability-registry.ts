import type { DesktopHostCapabilities, DesktopHostCapability } from '../../contracts/agent-protocol/v1/host-capabilities.js';

export interface HostCapabilitySources {
  readonly computer?: DesktopHostCapability;
}

/**
 * Centralizes native capability snapshots and operation checks for all host
 * brokers. Providers remain platform-specific; capability semantics do not.
 */
export class HostCapabilityRegistry {
  readonly snapshot: DesktopHostCapabilities;

  constructor(sources: HostCapabilitySources) {
    this.snapshot = {
      ...(sources.computer === undefined ? {} : { computer: sources.computer }),
    };
  }

  supportsComputer(operation: string): boolean {
    return supportsHostCapability(this.snapshot.computer, operation);
  }

  computerReason(operation: string): string | undefined {
    return capabilityReason(this.snapshot.computer, operation);
  }

}

export function supportsHostCapability(capability: DesktopHostCapability | undefined, operation: string): boolean {
  return capability === undefined || (capability.available && (capability.operations.includes('*') || capability.operations.includes(operation)));
}

function capabilityReason(capability: DesktopHostCapability | undefined, operation: string): string | undefined {
  if (supportsHostCapability(capability, operation)) return undefined;
  return capability?.reason ?? `The configured native provider does not support ${operation}.`;
}
