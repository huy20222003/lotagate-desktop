export type DesktopDocumentFormat = 'pdf' | 'pptx' | 'excel' | 'docs';

/** Native capability metadata sent to the CLI during the Desktop handshake. */
export interface DesktopHostCapability {
  readonly available: boolean;
  readonly provider: string;
  readonly operations: readonly string[];
  readonly reason?: string;
}

export interface DesktopHostCapabilities {
  readonly computer?: DesktopHostCapability;
  readonly documents?: Partial<Record<DesktopDocumentFormat, DesktopHostCapability>>;
}
