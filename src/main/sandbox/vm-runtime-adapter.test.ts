import { describe, expect, it } from 'vitest';
import { createBwrapArguments, createSeatbeltProfile, createWslArguments } from './vm-runtime-adapter.js';
import type { VmRuntimeStartInput } from './vm-types.js';

const input: VmRuntimeStartInput = {
  root: 'C:\\workspace',
  distribution: 'Ubuntu',
  profile: 'general',
  networkPolicy: 'none',
  workspaceAccess: 'read-write',
  memoryMb: 2_048,
  cpuCores: 2,
  pidsLimit: 128,
  diskMb: 8_192,
  guestRunnerPath: 'C:\\guest-runner.py',
  guestDocumentRunnerPath: 'C:\\document-runner.mjs',
  guestDocumentResourcesPath: 'C:\\document-use',
  idleTimeoutMinutes: 15,
};

describe('createWslArguments', () => {
  it('binds host workspace and resources before hiding WSL interop paths', () => {
    const args = createWslArguments(input, '/mnt/c/workspace', '/mnt/c/guest-runner.py', 'token', '/mnt/c/document-runner.mjs', '/mnt/c/document-use');
    const bwrap = args.indexOf('bwrap');
    const command = args.slice(bwrap + 1);
    const hideMnt = command.indexOf('/mnt');
    const workspace = command.indexOf('/workspace');
    const runner = command.indexOf('/opt/lotagate/sandbox/guest-runner.py');
    const documentResources = command.indexOf('/opt/lotagate/document-use');

    expect(hideMnt).toBeGreaterThan(workspace);
    expect(hideMnt).toBeGreaterThan(runner);
    expect(hideMnt).toBeGreaterThan(documentResources);
    expect(command).toContain('--unshare-net');
  });

  it('rejects an allowlist until a guest proxy is configured', () => {
    expect(() => createWslArguments({ ...input, networkPolicy: 'allowlist' }, '/mnt/c/workspace', '/mnt/c/guest-runner.py', 'token', undefined, undefined)).toThrow('guest proxy');
  });
});

describe('createBwrapArguments', () => {
  it('keeps the Linux backend on the shared guest runner policy', () => {
    const args = createBwrapArguments(input, '/workspace', '/app/guest-runner.py', 'token', undefined, undefined);
    expect(args[0]).toBe('bwrap');
    expect(args).toContain('--unshare-net');
    expect(args.slice(-6)).toEqual(['--', 'python3', '/opt/lotagate/sandbox/guest-runner.py', '--server', '--auth-token', 'token']);
  });
});

describe('createSeatbeltProfile', () => {
  it('allows only the workspace and temporary directories to be written', () => {
    const profile = createSeatbeltProfile(input, '/Users/test/workspace', '/var/folders/test');
    expect(profile).toContain('(deny default)');
    expect(profile).toContain('(subpath "/Users/test/workspace")');
    expect(profile).toContain('(subpath "/var/folders/test")');
    expect(profile).toContain('(deny network*)');
  });

  it('fails closed for allowlisted networking until a proxy boundary exists', () => {
    expect(() => createSeatbeltProfile({ ...input, networkPolicy: 'allowlist' }, '/Users/test/workspace', '/tmp')).toThrow('guest proxy');
  });
});
