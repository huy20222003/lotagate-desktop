import type { VmEnvironmentProfile } from './vm-types.js';

export interface VmProfileDescriptor {
  readonly id: VmEnvironmentProfile;
  readonly label: string;
  readonly guestCapabilities: readonly string[];
}

/** Describes the supported guest profiles without exposing image internals to the CLI. */
export const VM_PROFILE_CATALOG: readonly VmProfileDescriptor[] = [
  { id: 'general', label: 'Workspace runtime', guestCapabilities: ['filesystem', 'shell', 'git', 'python'] },
];

export function vmProfile(profile: VmEnvironmentProfile): VmProfileDescriptor {
  return VM_PROFILE_CATALOG.find(item => item.id === profile) ?? VM_PROFILE_CATALOG[0]!;
}
