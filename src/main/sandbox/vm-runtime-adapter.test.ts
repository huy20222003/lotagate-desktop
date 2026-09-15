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
  idleTimeoutMinutes: 15,
};

describe('createWslArguments', () => {
  it('binds the host workspace and runner before hiding WSL interop paths', () => {
    const args = createWslArguments(input, '/mnt/c/workspace', '/mnt/c/guest-runner.py', 'token');
    const bwrap = args.indexOf('bwrap');
    const command = args.slice(bwrap + 1);
    const hideMnt = command.indexOf('/mnt');
    const workspace = command.indexOf('/workspace');
    const runner = command.indexOf('/opt/lotagate/sandbox/guest-runner.py');

    expect(hideMnt).toBeGreaterThan(workspace);
    expect(hideMnt).toBeGreaterThan(runner);
    expect(command).toContain('--unshare-net');
  });

  it('uses the single shared WSL2 guest root and isolates its temporary paths', () => {
    const args = createWslArguments(input, '/mnt/c/workspace', '/mnt/c/guest-runner.py', 'token');
    expect(args).toContain('--ro-bind');
    expect(args).toContain('--clearenv');
    expect(args).toContain('--tmpfs');
  });
});

describe('createBwrapArguments', () => {
  it('keeps the Linux backend on the shared guest runner policy', () => {
    const args = createBwrapArguments(input, '/workspace', '/app/guest-runner.py', 'token');
    expect(args[0]).toBe('bwrap');
    expect(args).toContain('--unshare-net');
    expect(args).toContain('--ro-bind-try');
    expect(args.slice(-6)).toEqual(['--', 'python3', '/opt/lotagate/sandbox/guest-runner.py', '--server', '--auth-token', 'token']);
  });
});

describe('createSeatbeltProfile', () => {
  it('allows only the workspace and temporary directories to be written', () => {
    const profile = createSeatbeltProfile(input, '/Users/test/workspace', '/var/folders/test', '/Applications/LotaGate.app/Contents/Resources/sandbox/guest-runner.py', '/Applications/LotaGate.app/Contents/MacOS/Electron');
    expect(profile).toContain('(deny default)');
    expect(profile).toContain('(subpath "/Users/test/workspace")');
    expect(profile).toContain('(subpath "/var/folders/test")');
    expect(profile).toContain('(subpath "/tmp")');
    expect(profile).toContain('(subpath "/private/tmp")');
    expect(profile).toContain('(subpath "/Applications/LotaGate.app/Contents/Resources/sandbox/guest-runner.py")');
    expect(profile).toContain('(subpath "/Applications/LotaGate.app/Contents")');
    expect(profile).toContain('(deny network*)');
  });

  it('does not grant broad host file reads', () => {
    const profile = createSeatbeltProfile(input, '/Users/test/workspace', '/var/folders/test');
    expect(profile).toContain('(allow file-read*');
    expect(profile).not.toContain('(allow file-read*)');
  });
});
