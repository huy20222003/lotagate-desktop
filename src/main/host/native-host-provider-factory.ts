import type { DesktopHostCapabilities } from '../../contracts/agent-protocol/v1/host-capabilities.js';
import { COMPUTER_ACTION_TIMEOUT_MS, WindowsComputerService } from '../computer/windows-computer-service.js';
import { createPortableComputerService } from '../computer/portable-computer-service.js';
import type { ComputerRuntime } from '../computer/computer-runtime.js';
import { createPortableDocumentBackend } from '../documents/portable-document-backend.js';
import { PowerShellDocumentBackend } from '../documents/document-process-runner.js';
import { resolvePortableDocumentCommands } from '../documents/portable-document-command-resolver.js';
import type { DocumentBackend } from '../documents/document-backend.js';
import { HostCapabilityRegistry } from './host-capability-registry.js';

export interface NativeHostProviderFactoryOptions {
  readonly resourcePath: (directory: string, fileName: string) => string;
  readonly getApplicationAllowlist: () => readonly string[] | Promise<readonly string[]>;
}

export interface NativeHostProviders {
  readonly computer: ComputerRuntime;
  readonly documents: DocumentBackend;
  readonly capabilities: DesktopHostCapabilities;
}

/** Creates all native providers through one composition boundary. */
export async function createNativeHostProviders(options: NativeHostProviderFactoryOptions): Promise<NativeHostProviders> {
  const computer = process.platform === 'win32'
    ? new WindowsComputerService(options.resourcePath('computer-use', 'windows-computer.ps1'), COMPUTER_ACTION_TIMEOUT_MS, options.getApplicationAllowlist)
    : await createPortableComputerService(options.getApplicationAllowlist, options.resourcePath('computer-use', 'linux-computer-bridge.py'));
  const documents = process.platform === 'win32'
    ? new PowerShellDocumentBackend(options.resourcePath('document-use', 'windows-document.ps1'), await resolvePortableDocumentCommands())
    : await createPortableDocumentBackend(options.resourcePath('document-use', 'portable-office-bridge.py'));
  const capabilities = new HostCapabilityRegistry({
    ...(computer.capabilities === undefined ? {} : { computer: computer.capabilities }),
    documents: documents.capabilities,
  }).snapshot;
  return { computer, documents, capabilities };
}
